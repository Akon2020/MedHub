import type { EntityName } from '@medhub/domain';
import { phoneticKey, trigrams } from '@medhub/domain';
import type {
  ClientSyncStore,
  ClientSyncTx,
  LocalConflict,
  LocalEntity,
  OutboxItem,
  OutboxStatus,
  SyncStateRecord,
} from '@medhub/sync/client';
import { decryptJson, encryptJson, hmacToken, type LocalKeys } from './crypto';
import type { EntityRecord, MedHubLocalDb, OutboxRecord, SearchToken } from './database';

const DEFAULT_STATE: SyncStateRecord = {
  cursor: 0,
  lastSyncAt: null,
  lastServerTime: null,
  hlc: null,
  outboxSeq: 0,
};

type OutboxSecret = { op: OutboxItem['op']; lastError?: string };

/**
 * ClientSyncStore over an encrypted Dexie database.
 *
 * WebCrypto calls cannot run inside an IndexedDB transaction (it would commit
 * as soon as a foreign promise is awaited), so each logical transaction works
 * on an in-memory overlay; at the end every write is encrypted first, then
 * flushed in a single atomic Dexie transaction. A mutex serializes logical
 * transactions within the tab; the sync loop adds a Web Lock across tabs.
 */
export class EncryptedClientStore implements ClientSyncStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly db: MedHubLocalDb,
    private readonly keys: LocalKeys,
  ) {}

  transaction<T>(fn: (tx: ClientSyncTx) => Promise<T>): Promise<T> {
    const run = this.chain.then(() => this.runTransaction(fn));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runTransaction<T>(fn: (tx: ClientSyncTx) => Promise<T>): Promise<T> {
    const entities = new Map<string, { entity: EntityName; state: LocalEntity }>();
    const outboxPut = new Map<string, OutboxItem>();
    const outboxDelete = new Set<string>();
    const conflicts: LocalConflict[] = [];
    let statePatch: Partial<SyncStateRecord> = {};

    const loadOutbox = async (opId: string): Promise<OutboxItem | null> => {
      if (outboxDelete.has(opId)) return null;
      const staged = outboxPut.get(opId);
      if (staged) return staged;
      const record = await this.db.outbox.get(opId);
      return record ? this.decodeOutbox(record) : null;
    };

    const tx: ClientSyncTx = {
      getEntity: async (entity, id) => {
        const staged = entities.get(`${entity}:${id}`);
        if (staged) return structuredClone(staged.state);
        return this.readEntity(entity, id);
      },
      putEntity: async (entity, state) => {
        entities.set(`${entity}:${state.id}`, { entity, state: structuredClone(state) });
      },
      addOutbox: async (item) => {
        outboxDelete.delete(item.opId);
        outboxPut.set(item.opId, structuredClone(item));
      },
      listOutbox: async (statuses: readonly OutboxStatus[], limit?: number) => {
        const records = await this.db.outbox
          .where('status')
          .anyOf([...statuses])
          .toArray();
        const byId = new Map<string, OutboxItem>();
        for (const r of records) {
          if (!outboxDelete.has(r.opId)) byId.set(r.opId, await this.decodeOutbox(r));
        }
        for (const [opId, item] of outboxPut) {
          if (statuses.includes(item.status)) byId.set(opId, item);
          else byId.delete(opId);
        }
        const sorted = [...byId.values()].sort((a, b) => a.seq - b.seq);
        return limit === undefined ? sorted : sorted.slice(0, limit);
      },
      updateOutbox: async (opId, patch) => {
        const current = await loadOutbox(opId);
        if (current) outboxPut.set(opId, { ...current, ...patch });
      },
      removeOutbox: async (opId) => {
        outboxPut.delete(opId);
        outboxDelete.add(opId);
      },
      getSyncState: async () => ({ ...(await this.readState()), ...statePatch }),
      setSyncState: async (patch) => {
        statePatch = { ...statePatch, ...patch };
      },
      addConflict: async (conflict) => {
        conflicts.push(conflict);
      },
    };

    const result = await fn(tx);

    const entityRecords: EntityRecord[] = [];
    const tokens: { entityId: string; tokens: SearchToken[] }[] = [];
    for (const { entity, state } of entities.values()) {
      entityRecords.push(await this.encodeEntity(entity, state));
      if (entity === 'patient') {
        tokens.push({ entityId: state.id, tokens: await this.patientTokens(state) });
      }
    }
    const outboxRecords: OutboxRecord[] = [];
    for (const item of outboxPut.values()) outboxRecords.push(await this.encodeOutbox(item));
    const nextState = { ...(await this.readState()), ...statePatch };

    await this.db.transaction(
      'rw',
      [this.db.entities, this.db.outbox, this.db.syncState, this.db.conflicts, this.db.searchIndex],
      async () => {
        if (entityRecords.length) await this.db.entities.bulkPut(entityRecords);
        for (const t of tokens) {
          await this.db.searchIndex.where('entityId').equals(t.entityId).delete();
          if (t.tokens.length) await this.db.searchIndex.bulkPut(t.tokens);
        }
        if (outboxRecords.length) await this.db.outbox.bulkPut(outboxRecords);
        if (outboxDelete.size) await this.db.outbox.bulkDelete([...outboxDelete]);
        if (Object.keys(statePatch).length)
          await this.db.syncState.put({ key: 'state', ...nextState });
        if (conflicts.length) await this.db.conflicts.bulkPut(conflicts);
      },
    );
    return result;
  }

  async readEntity(entity: string, id: string): Promise<LocalEntity | null> {
    const record = await this.db.entities.get(`${entity}:${id}`);
    if (!record) return null;
    return this.decodeEntity(record);
  }

  async readEntities(entity: string): Promise<LocalEntity[]> {
    const records = await this.db.entities.where('entity').equals(entity).toArray();
    const out: LocalEntity[] = [];
    for (const r of records) if (!r.rejected) out.push(await this.decodeEntity(r));
    return out;
  }

  async readEntitiesByPatient(entity: string, patientId: string): Promise<LocalEntity[]> {
    const records = await this.db.entities
      .where('[entity+patientId]')
      .equals([entity, patientId])
      .toArray();
    const out: LocalEntity[] = [];
    for (const r of records) if (!r.rejected) out.push(await this.decodeEntity(r));
    return out;
  }

  /** Ranks patients by the number of hashed trigram and phonetic tokens in common. */
  async searchPatients(query: string, limit = 20): Promise<LocalEntity[]> {
    const grams = [
      ...trigrams(query),
      ...phoneticKey(query)
        .split(' ')
        .filter(Boolean)
        .map((p) => `ph:${p}`),
    ];
    if (grams.length === 0) return [];
    const hashed = await Promise.all(grams.map((g) => hmacToken(this.keys.indexKey, g)));
    const hits = await this.db.searchIndex.where('token').anyOf(hashed).toArray();
    const scores = new Map<string, number>();
    for (const hit of hits) scores.set(hit.entityId, (scores.get(hit.entityId) ?? 0) + 1);
    const threshold = Math.max(1, Math.floor(grams.length * 0.4));
    const ranked = [...scores.entries()]
      .filter(([, score]) => score >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    const out: LocalEntity[] = [];
    for (const [id] of ranked) {
      const entity = await this.readEntity('patient', id);
      if (entity && !entity.rejected) out.push(entity);
    }
    return out;
  }

  async readState(): Promise<SyncStateRecord> {
    const row = await this.db.syncState.get('state');
    if (!row) return { ...DEFAULT_STATE };
    const { key: _key, ...state } = row;
    return state;
  }

  async outboxCounts(): Promise<{ pending: number; rejected: number; conflicts: number }> {
    const [pending, sending, rejected, conflicts] = await Promise.all([
      this.db.outbox.where('status').equals('pending').count(),
      this.db.outbox.where('status').equals('sending').count(),
      this.db.outbox.where('status').equals('rejected').count(),
      this.db.conflicts.count(),
    ]);
    return { pending: pending + sending, rejected, conflicts };
  }

  async rejectedItems(): Promise<OutboxItem[]> {
    const records = await this.db.outbox.where('status').equals('rejected').toArray();
    return Promise.all(records.map((r) => this.decodeOutbox(r)));
  }

  private async encodeEntity(entity: string, state: LocalEntity): Promise<EntityRecord> {
    const patientId =
      entity === 'patient'
        ? state.id
        : typeof state.data.patientId === 'string'
          ? state.data.patientId
          : null;
    return {
      key: `${entity}:${state.id}`,
      entity,
      id: state.id,
      version: state.version,
      patientId,
      status: typeof state.data.status === 'string' ? state.data.status : null,
      rejected: state.rejected ? 1 : 0,
      enc: await encryptJson(this.keys.dataKey, state),
    };
  }

  private async decodeEntity(record: EntityRecord): Promise<LocalEntity> {
    return decryptJson<LocalEntity>(this.keys.dataKey, record.enc);
  }

  private async encodeOutbox(item: OutboxItem): Promise<OutboxRecord> {
    const secret: OutboxSecret = {
      op: item.op,
      ...(item.lastError ? { lastError: item.lastError } : {}),
    };
    return {
      opId: item.opId,
      seq: item.seq,
      status: item.status,
      attempts: item.attempts,
      entity: item.op.entity,
      entityId: item.op.entityId,
      enc: await encryptJson(this.keys.dataKey, secret),
    };
  }

  private async decodeOutbox(record: OutboxRecord): Promise<OutboxItem> {
    const secret = await decryptJson<OutboxSecret>(this.keys.dataKey, record.enc);
    return {
      opId: record.opId,
      seq: record.seq,
      status: record.status as OutboxStatus,
      attempts: record.attempts,
      op: secret.op,
      ...(secret.lastError ? { lastError: secret.lastError } : {}),
    };
  }

  private async patientTokens(state: LocalEntity): Promise<SearchToken[]> {
    const searchText = typeof state.data.searchText === 'string' ? state.data.searchText : '';
    const phonetic = typeof state.data.phoneticKey === 'string' ? state.data.phoneticKey : '';
    const grams = new Set([
      ...trigrams(searchText),
      ...phonetic
        .split(' ')
        .filter(Boolean)
        .map((p) => `ph:${p}`),
    ]);
    const out: SearchToken[] = [];
    for (const gram of grams) {
      const token = await hmacToken(this.keys.indexKey, gram);
      out.push({ key: `${token}|${state.id}`, token, entityId: state.id });
    }
    return out;
  }
}
