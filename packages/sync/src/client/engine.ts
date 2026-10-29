import { getCommand, type CommandName, type CommandPayload, type EntityName } from '@medhub/domain';
import { AppError, HybridLogicalClock, toIso, uuidv7, type Clock } from '@medhub/shared';
import {
  DEFAULT_PULL_LIMIT,
  MAX_PUSH_BYTES,
  MAX_PUSH_OPS,
  SYNC_SCHEMA_VERSION,
  type Operation,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type UnsignedOperation,
} from '../protocol';
import { createState, mergeFields, type EntityState } from '../reducers';

export type OutboxStatus = 'pending' | 'sending' | 'rejected' | 'needs_review';

export type OutboxItem = {
  opId: string;
  seq: number;
  op: Operation;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
};

export type LocalEntity = EntityState & {
  /** Set when the server rejected the operation that created this local row. */
  rejected?: boolean;
};

export type LocalConflict = {
  opId: string;
  entity: string;
  entityId: string;
  conflictId?: string;
  at: string;
};

export type SyncStateRecord = {
  cursor: number;
  lastSyncAt: number | null;
  lastServerTime: number | null;
  hlc: string | null;
  outboxSeq: number;
};

export interface ClientSyncTx {
  getEntity(entity: EntityName, id: string): Promise<LocalEntity | null>;
  putEntity(entity: EntityName, state: LocalEntity): Promise<void>;
  addOutbox(item: OutboxItem): Promise<void>;
  /** Ordered by `seq` ascending. */
  listOutbox(statuses: readonly OutboxStatus[], limit?: number): Promise<OutboxItem[]>;
  updateOutbox(opId: string, patch: Partial<OutboxItem>): Promise<void>;
  removeOutbox(opId: string): Promise<void>;
  getSyncState(): Promise<SyncStateRecord>;
  setSyncState(patch: Partial<SyncStateRecord>): Promise<void>;
  addConflict(conflict: LocalConflict): Promise<void>;
}

export interface ClientSyncStore {
  transaction<T>(fn: (tx: ClientSyncTx) => Promise<T>): Promise<T>;
}

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: number, options: { limit: number; lookback: boolean }): Promise<PullResponse>;
}

export class NetworkError extends Error {
  constructor(message = 'NETWORK_ERROR') {
    super(message);
    this.name = 'NetworkError';
  }
}

export type DeviceIdentity = {
  tenantId: string;
  siteId: string | null;
  userId: string;
  deviceId: string;
};

export type SyncClientOptions = {
  store: ClientSyncStore;
  transport: SyncTransport;
  clock: Clock;
  identity: DeviceIdentity;
  sign: (op: UnsignedOperation) => Operation | Promise<Operation>;
  permissions: ReadonlySet<string>;
  /** Cross-tab mutual exclusion (Web Locks in the browser); defaults to an in-memory flag. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
};

export type DispatchOptions = {
  entityId?: string;
  dependsOn?: string[];
};

export type PushSummary = {
  sent: number;
  acknowledged: number;
  rejected: number;
  conflicts: number;
};
export type PullSummary = { received: number; cursor: number };
export type SyncSummary = { push: PushSummary; pull: PullSummary };

const PENDING: readonly OutboxStatus[] = ['pending', 'sending'];
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export class SyncClient {
  private hlc: HybridLogicalClock | null = null;
  private running = false;

  constructor(private readonly opts: SyncClientOptions) {}

  async dispatch<N extends CommandName>(
    name: N,
    payload: CommandPayload<N>,
    options: DispatchOptions = {},
  ): Promise<{ opId: string; entityId: string }> {
    const command = getCommand(name);
    if (!command) throw new AppError('SYNC_UNKNOWN_COMMAND');
    if (command.onlineOnly) throw new AppError('SYNC_ONLINE_ONLY');
    if (!this.opts.permissions.has(command.permission))
      throw new AppError('PERMISSION_DENIED', 403);

    const parsed = command.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 400, {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const ruleError = command.check?.(parsed.data);
    if (ruleError) throw new AppError(ruleError as never);

    const entityId = options.entityId ?? uuidv7();
    if (command.kind === 'update' && !options.entityId) throw new AppError('NOT_FOUND', 404);

    return this.opts.store.transaction(async (tx) => {
      const state = await tx.getSyncState();
      const hlc = this.clockFor(state);
      const current =
        command.kind === 'update' ? await tx.getEntity(command.entity, entityId) : null;
      if (command.kind === 'update' && !current) throw new AppError('NOT_FOUND', 404);

      const now = this.opts.clock.now();
      const clockSuspect =
        state.lastServerTime !== null && now < state.lastServerTime - CLOCK_SKEW_TOLERANCE_MS;

      const unsigned: UnsignedOperation = {
        opId: uuidv7(),
        tenantId: this.opts.identity.tenantId,
        siteId: this.opts.identity.siteId,
        deviceId: this.opts.identity.deviceId,
        userId: this.opts.identity.userId,
        command: command.name,
        entity: command.entity,
        entityId,
        baseVersion: current ? current.version : null,
        payload: parsed.data,
        hlc: hlc.now(),
        clientTs: toIso(now),
        schemaVersion: SYNC_SCHEMA_VERSION,
        ...(options.dependsOn?.length ? { dependsOn: options.dependsOn } : {}),
        ...(clockSuspect ? { clockSuspect: true } : {}),
      };
      const op = await this.opts.sign(unsigned);

      await applyLocal(tx, op);
      const seq = state.outboxSeq + 1;
      await tx.addOutbox({ opId: op.opId, seq, op, status: 'pending', attempts: 0 });
      await tx.setSyncState({ hlc: hlc.current(), outboxSeq: seq });
      return { opId: op.opId, entityId };
    });
  }

  /** One full cycle: push until the outbox is empty, then pull until caught up. */
  async sync(): Promise<SyncSummary | undefined> {
    const run = async (): Promise<SyncSummary> => {
      const push = await this.push();
      const pull = await this.pull();
      return { push, pull };
    };
    if (this.opts.withLock) return this.opts.withLock(run);
    if (this.running) return undefined;
    this.running = true;
    try {
      return await run();
    } finally {
      this.running = false;
    }
  }

  async push(): Promise<PushSummary> {
    const summary: PushSummary = { sent: 0, acknowledged: 0, rejected: 0, conflicts: 0 };
    for (;;) {
      const batch = await this.opts.store.transaction(async (tx) => {
        const items = await tx.listOutbox(PENDING, MAX_PUSH_OPS);
        const selected: OutboxItem[] = [];
        let bytes = 0;
        for (const item of items) {
          const size = JSON.stringify(item.op).length;
          if (selected.length > 0 && bytes + size > MAX_PUSH_BYTES) break;
          bytes += size;
          selected.push(item);
        }
        for (const item of selected) {
          await tx.updateOutbox(item.opId, { status: 'sending', attempts: item.attempts + 1 });
        }
        return selected;
      });
      if (batch.length === 0) return summary;

      let response: PushResponse;
      try {
        response = await this.opts.transport.push({
          deviceId: this.opts.identity.deviceId,
          schemaVersion: SYNC_SCHEMA_VERSION,
          ops: batch.map((item) => item.op),
        });
      } catch (error) {
        throw error instanceof NetworkError ? error : new NetworkError(String(error));
      }
      summary.sent += batch.length;

      await this.opts.store.transaction(async (tx) => {
        const byId = new Map(batch.map((item) => [item.opId, item]));
        for (const result of response.results) {
          const item = byId.get(result.opId);
          if (!item) continue;
          switch (result.status) {
            case 'applied':
            case 'merged':
            case 'duplicate':
              await tx.removeOutbox(item.opId);
              summary.acknowledged += 1;
              break;
            case 'rejected':
              await tx.updateOutbox(item.opId, {
                status: 'rejected',
                lastError: result.reason ?? 'REJECTED',
              });
              await markRejected(tx, item.op);
              summary.rejected += 1;
              break;
            case 'needs_review':
              await tx.removeOutbox(item.opId);
              await tx.addConflict({
                opId: item.opId,
                entity: item.op.entity,
                entityId: item.op.entityId,
                ...(result.conflictId ? { conflictId: result.conflictId } : {}),
                at: response.serverTime,
              });
              summary.conflicts += 1;
              break;
          }
        }
        await tx.setSyncState({ lastServerTime: Date.parse(response.serverTime) });
      });
    }
  }

  async pull(): Promise<PullSummary> {
    let received = 0;
    let lookback = true;
    for (;;) {
      const state = await this.opts.store.transaction((tx) => tx.getSyncState());
      let response: PullResponse;
      try {
        response = await this.opts.transport.pull(state.cursor, {
          limit: DEFAULT_PULL_LIMIT,
          lookback,
        });
      } catch (error) {
        throw error instanceof NetworkError ? error : new NetworkError(String(error));
      }
      lookback = false;

      await this.opts.store.transaction(async (tx) => {
        for (const change of response.changes) {
          await applyRemote(
            tx,
            change.entity as EntityName,
            change.entityId,
            change.version,
            change.data,
          );
        }
        await tx.setSyncState({
          cursor: Math.max(state.cursor, response.nextCursor),
          lastSyncAt: this.opts.clock.now(),
          lastServerTime: Date.parse(response.serverTime),
        });
      });
      received += response.changes.length;
      if (!response.hasMore) {
        const final = await this.opts.store.transaction((tx) => tx.getSyncState());
        return { received, cursor: final.cursor };
      }
    }
  }

  private clockFor(state: SyncStateRecord): HybridLogicalClock {
    if (!this.hlc) {
      this.hlc = new HybridLogicalClock(
        this.opts.clock,
        this.opts.identity.deviceId,
        state.hlc ?? undefined,
      );
    }
    return this.hlc;
  }
}

/** Optimistic local application; the server remains the authority on merge outcome. */
export async function applyLocal(tx: ClientSyncTx, op: Operation): Promise<void> {
  const command = getCommand(op.command);
  if (!command) throw new AppError('SYNC_UNKNOWN_COMMAND');
  const entity = command.entity;
  const payload = op.payload as Record<string, unknown>;
  const existing = await tx.getEntity(entity, op.entityId);

  if (command.kind === 'update' || (command.kind === 'create' && existing)) {
    if (!existing) return;
    const outcome = mergeFields(
      entity,
      { ...existing, fieldMeta: {} },
      op,
      payload,
      existing.version,
    );
    await tx.putEntity(entity, { ...outcome.next, fieldMeta: existing.fieldMeta });
    return;
  }
  if (command.kind === 'append') {
    if (typeof payload.supersedesId === 'string') {
      const target = await tx.getEntity(entity, payload.supersedesId);
      if (target && target.data.status !== 'superseded') {
        await tx.putEntity(entity, { ...target, data: { ...target.data, status: 'superseded' } });
      }
    }
    if (!existing) {
      await tx.putEntity(
        entity,
        createState(entity, op.entityId, op, { ...payload, status: 'active' }, 0),
      );
    }
    return;
  }
  if (!existing) await tx.putEntity(entity, createState(entity, op.entityId, op, payload, 0));
}

/**
 * Replaces the local row with the server version, then replays the operations
 * still waiting in the outbox so that unsent work is never hidden.
 */
export async function applyRemote(
  tx: ClientSyncTx,
  entity: EntityName,
  entityId: string,
  version: number,
  data: Record<string, unknown> | null,
): Promise<void> {
  const local = await tx.getEntity(entity, entityId);
  if (local && !local.rejected && local.version >= version) return;
  if (!data) return;

  const { id: _id, ...fields } = data;
  await tx.putEntity(entity, {
    id: entityId,
    version,
    data: fields,
    fieldMeta: {},
    hlc: local?.hlc ?? '',
    opId: local?.opId ?? '',
    deviceId: local?.deviceId ?? '',
    createdBy: local?.createdBy ?? '',
  });

  const pending = await tx.listOutbox(PENDING);
  for (const item of pending) {
    const payload = item.op.payload as Record<string, unknown>;
    if (item.op.entityId === entityId || payload.supersedesId === entityId) {
      await applyLocal(tx, item.op);
    }
  }
}

async function markRejected(tx: ClientSyncTx, op: Operation): Promise<void> {
  const command = getCommand(op.command);
  if (!command || command.kind === 'update') return;
  const local = await tx.getEntity(command.entity, op.entityId);
  if (local && local.version === 0)
    await tx.putEntity(command.entity, { ...local, rejected: true });
}
