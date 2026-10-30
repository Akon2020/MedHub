import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

export type TenantContext = {
  tenantId: string;
  userId: string | null;
  deviceId?: string | null;
};

export type PlatformContext = {
  actorId: string | null;
  reason: string;
};

/**
 * Every business query runs inside this transaction. `set_config(..., true)`
 * scopes the settings to the transaction, which is mandatory with a pool.
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.user_id', ${ctx.userId ?? ''}, true),
      set_config('app.device_id', ${ctx.deviceId ?? ''}, true),
      set_config('app.scope', 'tenant', true)`);
    return fn(tx);
  });
}

/**
 * Read-only platform scope for supervision and export. Only importable from
 * server/platform and server/modules/sadm (enforced by ESLint in apps/web).
 */
export async function withPlatformScope<T>(
  db: Db,
  ctx: PlatformContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', '', true),
      set_config('app.user_id', ${ctx.actorId ?? ''}, true),
      set_config('app.scope', 'platform', true)`);
    return fn(tx);
  });
}

/** Transactions on platform tables only (tenant, job, permission catalog). */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', '', true), set_config('app.scope', 'system', true)`,
    );
    return fn(tx);
  });
}
