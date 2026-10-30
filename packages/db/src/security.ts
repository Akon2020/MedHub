import { uuidv7 } from '@medhub/shared';
import { sql } from 'drizzle-orm';
import type { Tx } from './client';
import { securityEvent } from './schema';

export type RateLimitHit = { hits: number; windowStart: Date };

/**
 * Fixed-window counter in a single statement, so concurrent requests on the
 * pooled connections of several Passenger processes all see the same count.
 */
export async function consumeRateLimit(
  tx: Tx,
  key: string,
  windowSeconds: number,
): Promise<RateLimitHit> {
  const result = await tx.execute<{ hits: number; window_start: Date | string }>(sql`
    insert into rate_limit (key, window_start, hits) values (${key}, now(), 1)
    on conflict (key) do update set
      hits = case when rate_limit.window_start < now() - make_interval(secs => ${windowSeconds})
                  then 1 else rate_limit.hits + 1 end,
      window_start = case when rate_limit.window_start < now() - make_interval(secs => ${windowSeconds})
                  then now() else rate_limit.window_start end
    returning hits, window_start`);
  const row = result.rows[0];
  if (!row) throw new Error('rate_limit upsert returned no row');
  return { hits: Number(row.hits), windowStart: new Date(row.window_start) };
}

/** Counters are infrastructure, not business data: stale windows are purged. */
export async function purgeRateLimits(tx: Tx, olderThanSeconds = 86_400): Promise<number> {
  const result = await tx.execute(
    sql`delete from rate_limit where window_start < now() - make_interval(secs => ${olderThanSeconds})`,
  );
  return result.rowCount ?? 0;
}

export type SecurityEventInput = {
  kind: string;
  severity?: 'info' | 'warning' | 'critical';
  tenantId?: string | null;
  userId?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordSecurityEvent(tx: Tx, event: SecurityEventInput): Promise<void> {
  await tx.insert(securityEvent).values({
    id: uuidv7(),
    kind: event.kind,
    severity: event.severity ?? 'info',
    targetTenantId: event.tenantId ?? null,
    userId: event.userId ?? null,
    ip: event.ip ?? null,
    detail: event.detail ?? {},
  });
}
