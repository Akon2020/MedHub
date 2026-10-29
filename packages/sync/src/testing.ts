import type { EntityName } from '@medhub/domain';
import type { StockMovementKind } from '@medhub/shared';
import type {
  ClientSyncStore,
  ClientSyncTx,
  LocalConflict,
  LocalEntity,
  OutboxItem,
  OutboxStatus,
  SyncStateRecord,
} from './client/engine';
import type { OpResult, Operation } from './protocol';
import type { EntityState } from './reducers';
import {
  DuplicateOperationError,
  type ChangeEntry,
  type ConflictEntry,
  type ServerSyncStore,
  type ServerSyncTx,
} from './server/engine';
import type { ChangeRow, ServerPullStore } from './server/pull';

type ServerData = {
  ops: Map<string, { op: Operation; result: OpResult }>;
  entities: Map<string, EntityState & { entity: EntityName }>;
  changes: (ChangeRow & { opId: string; scopeKeys: string[] })[];
  conflicts: Map<string, ConflictEntry>;
};

function cloneServer(data: ServerData): ServerData {
  return structuredClone(data);
}

/**
 * In-memory server used by the property tests. Transactions work on a copy and
 * only replace the state on success, which reproduces rollback semantics.
 */
export class MemoryServerStore implements ServerSyncStore, ServerPullStore {
  data: ServerData = { ops: new Map(), entities: new Map(), changes: [], conflicts: new Map() };
  private seq = 0;
  private conflictSeq = 0;

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async findOpResult(opId: string): Promise<OpResult | null> {
    return this.data.ops.get(opId)?.result ?? null;
  }

  async transaction<T>(fn: (tx: ServerSyncTx) => Promise<T>): Promise<T> {
    const draft = cloneServer(this.data);
    const seqStart = this.seq;
    const tx: ServerSyncTx = {
      findOpResult: async (opId) => draft.ops.get(opId)?.result ?? null,
      saveOp: async (op, result) => {
        if (draft.ops.has(op.opId)) throw new DuplicateOperationError();
        draft.ops.set(op.opId, { op, result });
      },
      getEntity: async (entity, id) => {
        const row = draft.entities.get(`${entity}:${id}`);
        return row ? stripEntity(row) : null;
      },
      insertEntity: async (entity, state) => {
        draft.entities.set(`${entity}:${state.id}`, { ...structuredClone(state), entity });
      },
      updateEntity: async (entity, state) => {
        draft.entities.set(`${entity}:${state.id}`, { ...structuredClone(state), entity });
      },
      appendChange: async (change: ChangeEntry) => {
        this.seq += 1;
        draft.changes.push({ ...change, seq: this.seq, changedAtMs: this.nowMs() });
      },
      createConflict: async (conflict) => {
        this.conflictSeq += 1;
        const id = `conflict-${this.conflictSeq}`;
        draft.conflicts.set(id, conflict);
        return id;
      },
      listStockMovements: async (warehouseId, productId) =>
        [...draft.entities.values()]
          .filter(
            (e) =>
              e.entity === 'stock_movement' &&
              e.data.warehouseId === warehouseId &&
              e.data.productId === productId,
          )
          .map((e) => ({
            kind: e.data.kind as StockMovementKind,
            quantity: Number(e.data.quantity),
          })),
    };
    try {
      const result = await fn(tx);
      this.data = draft;
      return result;
    } catch (error) {
      this.seq = seqStart;
      throw error;
    }
  }

  async listChangesAfter(afterSeq: number, limit: number): Promise<ChangeRow[]> {
    return this.data.changes.filter((c) => c.seq > afterSeq).slice(0, limit);
  }

  async listRecentChanges(fromSeq: number, toSeq: number, sinceMs: number): Promise<ChangeRow[]> {
    return this.data.changes.filter(
      (c) => c.seq > fromSeq && c.seq <= toSeq && c.changedAtMs >= sinceMs,
    );
  }

  async getEntities(entity: EntityName, ids: string[]): Promise<EntityState[]> {
    return ids
      .map((id) => this.data.entities.get(`${entity}:${id}`))
      .filter((row): row is EntityState & { entity: EntityName } => row !== undefined)
      .map(stripEntity);
  }

  entitiesOf(entity: EntityName): EntityState[] {
    return [...this.data.entities.values()].filter((e) => e.entity === entity).map(stripEntity);
  }
}

function stripEntity(row: EntityState & { entity?: EntityName }): EntityState {
  const { entity: _entity, ...state } = structuredClone(row);
  return state;
}

type ClientData = {
  entities: Map<string, LocalEntity & { entity: EntityName }>;
  outbox: Map<string, OutboxItem>;
  state: SyncStateRecord;
  conflicts: LocalConflict[];
};

export class MemoryClientStore implements ClientSyncStore {
  data: ClientData = {
    entities: new Map(),
    outbox: new Map(),
    state: { cursor: 0, lastSyncAt: null, lastServerTime: null, hlc: null, outboxSeq: 0 },
    conflicts: [],
  };

  async transaction<T>(fn: (tx: ClientSyncTx) => Promise<T>): Promise<T> {
    const draft = structuredClone(this.data);
    const tx: ClientSyncTx = {
      getEntity: async (entity, id) => {
        const row = draft.entities.get(`${entity}:${id}`);
        if (!row) return null;
        const { entity: _e, ...state } = structuredClone(row);
        return state;
      },
      putEntity: async (entity, state) => {
        draft.entities.set(`${entity}:${state.id}`, { ...structuredClone(state), entity });
      },
      addOutbox: async (item) => {
        draft.outbox.set(item.opId, structuredClone(item));
      },
      listOutbox: async (statuses: readonly OutboxStatus[], limit?: number) => {
        const items = [...draft.outbox.values()]
          .filter((i) => statuses.includes(i.status))
          .sort((a, b) => a.seq - b.seq);
        return structuredClone(limit === undefined ? items : items.slice(0, limit));
      },
      updateOutbox: async (opId, patch) => {
        const item = draft.outbox.get(opId);
        if (item) draft.outbox.set(opId, { ...item, ...patch });
      },
      removeOutbox: async (opId) => {
        draft.outbox.delete(opId);
      },
      getSyncState: async () => ({ ...draft.state }),
      setSyncState: async (patch) => {
        draft.state = { ...draft.state, ...patch };
      },
      addConflict: async (conflict) => {
        draft.conflicts.push(conflict);
      },
    };
    const result = await fn(tx);
    this.data = draft;
    return result;
  }

  entitiesOf(entity: EntityName): LocalEntity[] {
    return [...this.data.entities.values()]
      .filter((e) => e.entity === entity && !e.rejected)
      .map(({ entity: _e, ...state }) => state);
  }
}
