import type { EntityName } from '@medhub/domain';
import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  PULL_LOOKBACK_MS,
  PULL_LOOKBACK_SEQ,
  type ChangeRecord,
  type PullResponse,
} from '../protocol';
import type { EntityState } from '../reducers';

export type ChangeRow = {
  seq: number;
  entity: EntityName;
  entityId: string;
  version: number;
  changedAtMs: number;
};

export interface ServerPullStore {
  /** Rows with seq strictly greater than `afterSeq`, ascending, at most `limit`. */
  listChangesAfter(afterSeq: number, limit: number): Promise<ChangeRow[]>;
  /** Rows with seq in (fromSeq, toSeq] changed after `sinceMs`, used to catch late commits. */
  listRecentChanges(fromSeq: number, toSeq: number, sinceMs: number): Promise<ChangeRow[]>;
  getEntities(entity: EntityName, ids: string[]): Promise<EntityState[]>;
}

export type PullOptions = {
  cursor: number;
  limit?: number;
  /** True on the first page of a pull cycle. */
  lookback?: boolean;
  nowMs: number;
  serverTime: string;
};

export async function processPull(
  store: ServerPullStore,
  opts: PullOptions,
): Promise<PullResponse> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PULL_LIMIT, 1), MAX_PULL_LIMIT);
  const cursor = Math.max(0, Math.floor(opts.cursor));

  const forward = await store.listChangesAfter(cursor, limit);
  const late =
    opts.lookback && cursor > 0
      ? await store.listRecentChanges(
          Math.max(0, cursor - PULL_LOOKBACK_SEQ),
          cursor,
          opts.nowMs - PULL_LOOKBACK_MS,
        )
      : [];

  const latest = new Map<string, ChangeRow>();
  for (const row of [...late, ...forward]) {
    latest.set(`${row.entity}:${row.entityId}`, row);
  }

  const byEntity = new Map<EntityName, string[]>();
  for (const row of latest.values()) {
    const ids = byEntity.get(row.entity) ?? [];
    ids.push(row.entityId);
    byEntity.set(row.entity, ids);
  }

  const states = new Map<string, EntityState>();
  for (const [entity, ids] of byEntity) {
    for (const state of await store.getEntities(entity, ids)) {
      states.set(`${entity}:${state.id}`, state);
    }
  }

  const changes: ChangeRecord[] = [...latest.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((row) => {
      const state = states.get(`${row.entity}:${row.entityId}`);
      return {
        seq: row.seq,
        entity: row.entity,
        entityId: row.entityId,
        version: state?.version ?? row.version,
        data: state ? { ...state.data, id: state.id } : null,
      };
    });

  const maxForward = forward.reduce((m, r) => Math.max(m, r.seq), cursor);
  return {
    changes,
    nextCursor: maxForward,
    hasMore: forward.length === limit,
    serverTime: opts.serverTime,
  };
}
