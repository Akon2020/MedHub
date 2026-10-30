import { sql } from 'drizzle-orm';
import { database } from '@/server/platform/db';
import { json } from '@/server/platform/http';
import { telemetry } from '@/server/platform/telemetry';

export const dynamic = 'force-dynamic';

const TICK_STALE_MS = 5 * 60 * 1000;

/** Health probe: database, applied migrations and age of the last worker tick. */
export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    const { db } = database();
    await db.execute(sql`select 1`);
    const migrations = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    const tick = await db.execute<{ finished_at: Date | null }>(
      sql`select finished_at from job_tick where ok order by started_at desc limit 1`,
    );
    const lastTick = tick.rows[0]?.finished_at ?? null;
    const tickAgeMs = lastTick ? Date.now() - new Date(lastTick).getTime() : null;
    return json({
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
      database: 'ok',
      migrations: Number(migrations.rows[0]?.count ?? 0),
      worker: tickAgeMs === null ? 'never' : tickAgeMs > TICK_STALE_MS ? 'stale' : 'ok',
      lastTickAgeSeconds: tickAgeMs === null ? null : Math.round(tickAgeMs / 1000),
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    telemetry().captureError(error, { route: 'health' });
    return json({ status: 'error', database: 'unreachable' }, { status: 503 });
  }
}
