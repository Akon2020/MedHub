import { retryDelay, schema, withSystem, type DbHandle } from '@medhub/db';
import { uuidv7 } from '@medhub/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { nextRun } from './cron';
import { DEFAULT_SCHEDULES, HANDLERS, type JobHandler } from './handlers';

export type TickOptions = {
  budgetMs?: number;
  batchSize?: number;
  now?: () => Date;
  handlers?: Record<string, JobHandler>;
  log?: (message: string) => void;
};

export type TickResult = { skipped: boolean; processed: number; failed: number };

const LOCK_KEY = 'medhub-worker-tick';

/**
 * One pass of the job queue, as run by cron every minute. A global advisory
 * lock prevents overlapping ticks; the pass stops after `budgetMs` (50 s) so a
 * tick never runs into the next one.
 */
export async function runTick(handle: DbHandle, options: TickOptions = {}): Promise<TickResult> {
  const now = options.now ?? (() => new Date());
  const budgetMs = options.budgetMs ?? 50_000;
  const batchSize = options.batchSize ?? 10;
  const handlers = options.handlers ?? HANDLERS;
  const log = options.log ?? (() => undefined);
  const workerId = `tick-${uuidv7()}`;
  const started = Date.now();

  const lockClient = await handle.pool.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)) as locked',
      [LOCK_KEY],
    );
    if (!rows[0]?.locked) return { skipped: true, processed: 0, failed: 0 };

    const tickId = uuidv7();
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.jobTick).values({ id: tickId, startedAt: now() }),
    );

    await materializeSchedules(handle, now());

    let processed = 0;
    let failed = 0;
    while (Date.now() - started < budgetMs) {
      const batch = await withSystem(handle.db, async (tx) => {
        const due = await tx
          .select({ id: schema.job.id })
          .from(schema.job)
          .where(and(eq(schema.job.status, 'queued'), lte(schema.job.runAt, now())))
          .orderBy(asc(schema.job.runAt))
          .limit(batchSize)
          .for('update', { skipLocked: true });
        if (due.length === 0) return [];
        return tx
          .update(schema.job)
          .set({
            status: 'running',
            lockedAt: now(),
            lockedBy: workerId,
            attempts: sql`${schema.job.attempts} + 1`,
            updatedAt: now(),
          })
          .where(
            inArray(
              schema.job.id,
              due.map((d) => d.id),
            ),
          )
          .returning();
      });
      if (batch.length === 0) break;

      for (const item of batch) {
        const handler = handlers[item.type];
        try {
          if (!handler) throw new Error(`JOB_UNKNOWN_TYPE:${item.type}`);
          await handler({ db: handle.db, tenantId: item.tenantId, payload: item.payload, log });
          await withSystem(handle.db, (tx) =>
            tx
              .update(schema.job)
              .set({ status: 'done', lastError: null, updatedAt: now() })
              .where(eq(schema.job.id, item.id)),
          );
          processed += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message.slice(0, 500) : 'JOB_FAILED';
          const dead = item.attempts >= item.maxAttempts;
          await withSystem(handle.db, (tx) =>
            tx
              .update(schema.job)
              .set({
                status: dead ? 'dead' : 'queued',
                lastError: message,
                runAt: dead ? item.runAt : new Date(now().getTime() + retryDelay(item.attempts)),
                updatedAt: now(),
              })
              .where(eq(schema.job.id, item.id)),
          );
          log(`job ${item.type} failed (attempt ${item.attempts}): ${message}`);
        }
      }
    }

    await withSystem(handle.db, (tx) =>
      tx
        .update(schema.jobTick)
        .set({ finishedAt: now(), processed, failed, ok: true })
        .where(eq(schema.jobTick.id, tickId)),
    );
    return { skipped: false, processed, failed };
  } finally {
    await lockClient
      .query('select pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
      .catch(() => undefined);
    lockClient.release();
  }
}

/** Inserts the occurrences of recurring jobs that are due, then moves next_run_at forward. */
async function materializeSchedules(handle: DbHandle, at: Date): Promise<void> {
  await withSystem(handle.db, async (tx) => {
    for (const s of DEFAULT_SCHEDULES) {
      await tx
        .insert(schema.jobSchedule)
        .values({ type: s.type, cron: s.cron, nextRunAt: nextRun(s.cron, at) })
        .onConflictDoNothing();
    }
    const due = await tx
      .select()
      .from(schema.jobSchedule)
      .where(and(eq(schema.jobSchedule.enabled, true), lte(schema.jobSchedule.nextRunAt, at)))
      .for('update', { skipLocked: true });
    for (const s of due) {
      await tx.insert(schema.job).values({ id: uuidv7(), type: s.type, payload: {}, runAt: at });
      await tx
        .update(schema.jobSchedule)
        .set({ nextRunAt: nextRun(s.cron, at) })
        .where(eq(schema.jobSchedule.type, s.type));
    }
  });
}
