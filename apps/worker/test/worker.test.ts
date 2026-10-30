import { resolve } from 'node:path';
import { createDb, enqueue, schema, withSystem, type DbHandle } from '@medhub/db';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextRun } from '../src/cron';
import { runTick } from '../src/tick';

config({
  path: [resolve(__dirname, '../../../.env.local'), resolve(__dirname, '../../../.env')],
  quiet: true,
});

describe('cron', () => {
  it('finds the next matching minute in UTC', () => {
    const from = new Date('2026-10-29T10:07:30Z');
    expect(nextRun('*/15 * * * *', from).toISOString()).toBe('2026-10-29T10:15:00.000Z');
    expect(nextRun('30 1 * * *', from).toISOString()).toBe('2026-10-30T01:30:00.000Z');
    expect(nextRun('0 8 * * 1', from).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('rejects malformed expressions', () => {
    expect(() => nextRun('61 * * * *', new Date())).toThrow();
    expect(() => nextRun('* * *', new Date())).toThrow();
  });
});

const url = process.env.TEST_DATABASE_URL;
let handle: DbHandle;

describe.skipIf(!url)('tick', () => {
  beforeAll(() => {
    handle = createDb(url as string, 4);
  });
  afterAll(async () => {
    await handle?.pool.end();
  });

  it('runs due jobs, retries failures and records the tick', async () => {
    const ids = await withSystem(handle.db, async (tx) => [
      await enqueue(tx, 'test.ok'),
      await enqueue(tx, 'test.fail', {}, { maxAttempts: 2 }),
    ]);
    const seen: string[] = [];
    const result = await runTick(handle, {
      budgetMs: 20_000,
      handlers: {
        'test.ok': async () => {
          seen.push('ok');
        },
        'test.fail': async () => {
          throw new Error('boom');
        },
        'audit.verify_chains': async () => undefined,
      },
    });
    expect(result.skipped).toBe(false);
    expect(seen).toContain('ok');

    const rows = await withSystem(handle.db, (tx) => tx.select().from(schema.job));
    const ok = rows.find((r) => r.id === ids[0]);
    const failing = rows.find((r) => r.id === ids[1]);
    expect(ok?.status).toBe('done');
    expect(failing?.status).toBe('queued');
    expect(failing?.lastError).toBe('boom');
    expect(failing && failing.runAt.getTime()).toBeGreaterThan(Date.now());

    await withSystem(handle.db, (tx) =>
      tx
        .update(schema.job)
        .set({ runAt: new Date(0) })
        .where(eq(schema.job.id, ids[1] as string)),
    );
    await runTick(handle, {
      budgetMs: 20_000,
      handlers: {
        'test.fail': async () => {
          throw new Error('boom again');
        },
        'audit.verify_chains': async () => undefined,
      },
    });
    const [dead] = await withSystem(handle.db, (tx) =>
      tx
        .select()
        .from(schema.job)
        .where(eq(schema.job.id, ids[1] as string)),
    );
    expect(dead?.status).toBe('dead');
  });
});
