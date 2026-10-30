import { uuidv7 } from '@medhub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../../src/audit';
import { createDb, type DbHandle } from '../../src/client';
import { withSystem, withTenant } from '../../src/context';
import { rlsStatus, tenantTables } from '../../src/rls';
import { tenant, vitalSign } from '../../src/schema';
import { runMigrations } from '../../scripts/migrate';
import { requireEnv } from '../../scripts/env';
import { FACTORIES } from './fixtures';

const url = requireEnv('TEST_DATABASE_URL');
let handle: DbHandle;
const tenantA = uuidv7();
const tenantB = uuidv7();

async function createTenant(id: string, code: string) {
  await withSystem(handle.db, (tx) =>
    tx.insert(tenant).values({
      id,
      code,
      legalName: 'Structure de test',
      displayName: 'Structure de test',
      type: 'clinic',
    }),
  );
}

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, 4);
  const suffix = String(Math.floor(Math.random() * 9000) + 1000);
  await createTenant(tenantA, `TSA-ISO-${suffix}`);
  await createTenant(tenantB, `TSB-ISO-${suffix}`);
  for (const factory of Object.values(FACTORIES)) {
    await withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) => factory(tx, tenantA));
    await withTenant(handle.db, { tenantId: tenantB, userId: null }, (tx) => factory(tx, tenantB));
  }
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
});

describe('row level security', () => {
  it('is enabled and forced on every table with a tenant_id', async () => {
    const client = await handle.pool.connect();
    try {
      const status = await rlsStatus(client);
      expect(status.length).toBeGreaterThan(0);
      for (const s of status) {
        expect(s, s.table).toMatchObject({ enabled: true, forced: true });
        expect(s.policies.sort(), s.table).toEqual(['platform_scope', 'tenant_isolation']);
      }
    } finally {
      client.release();
    }
  });

  it('has an isolation factory for every tenant table', async () => {
    const client = await handle.pool.connect();
    try {
      expect((await tenantTables(client)).sort()).toEqual(Object.keys(FACTORIES).sort());
    } finally {
      client.release();
    }
  });

  for (const table of Object.keys(FACTORIES)) {
    describe(table, () => {
      it('only shows rows of the current structure', async () => {
        const rows = await withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) =>
          tx.execute<{ tenant_id: string }>(sql.raw(`select tenant_id from "${table}"`)),
        );
        expect(rows.rows.length).toBeGreaterThan(0);
        expect(rows.rows.every((r) => r.tenant_id === tenantA)).toBe(true);
      });

      it('cannot update rows of another structure', async () => {
        const result = await withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) =>
          tx.execute(
            sql.raw(`update "${table}" set tenant_id = tenant_id where tenant_id = '${tenantB}'`),
          ),
        );
        expect(result.rowCount).toBe(0);
      });

      it('cannot insert a row for another structure', async () => {
        const factory = FACTORIES[table];
        if (!factory) throw new Error(table);
        await expect(
          withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) => factory(tx, tenantB)),
        ).rejects.toThrow();
      });

      it('shows nothing without a structure context', async () => {
        const rows = await handle.db.transaction((tx) =>
          tx.execute(sql.raw(`select 1 from "${table}"`)),
        );
        expect(rows.rows.length).toBe(0);
      });
    });
  }
});

describe('append-only guards', () => {
  it('refuses to delete a vital sign', async () => {
    await expect(
      withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) => tx.delete(vitalSign)),
    ).rejects.toThrow();
  });

  it('refuses to change a recorded value', async () => {
    await expect(
      withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) =>
        tx.update(vitalSign).set({ value: 40 }),
      ),
    ).rejects.toThrow();
  });

  it('allows marking a vital sign as superseded', async () => {
    const result = await withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) =>
      tx.update(vitalSign).set({ status: 'superseded' }).returning({ id: vitalSign.id }),
    );
    expect(result.length).toBeGreaterThan(0);
  });

  it('refuses to delete a stock movement', async () => {
    await expect(
      withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) =>
        tx.execute(sql`delete from stock_movement`),
      ),
    ).rejects.toThrow();
  });
});

describe('audit chain', () => {
  it('verifies an intact chain and detects a manual modification', async () => {
    const intact = await withTenant(handle.db, { tenantId: tenantA, userId: null }, (tx) =>
      verifyAuditChain(tx, tenantA),
    );
    expect(intact.ok).toBe(true);

    const tampered = await withTenant(
      handle.db,
      { tenantId: tenantA, userId: null },
      async (tx) => {
        await tx.execute(sql`alter table audit_log disable trigger medhub_no_update`);
        await tx.execute(sql`update audit_log set action = 'read' where tenant_id = ${tenantA}`);
        const check = await verifyAuditChain(tx, tenantA);
        await tx.execute(sql`alter table audit_log enable trigger medhub_no_update`);
        throw Object.assign(new Error('rollback'), { check });
      },
    ).catch((error: { check?: unknown }) => error.check);
    expect(tampered).toMatchObject({ ok: false });
  });
});
