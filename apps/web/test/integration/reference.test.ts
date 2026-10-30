import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { DRC_PROVINCES, isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const otherTenantId = uuidv7();
const adminId = uuidv7();
const clerkId = uuidv7();
const suffix = String(Math.floor(Math.random() * 9000) + 1000);
const client = { ip: '203.0.113.40' };

let handle: DbHandle;
type Reference = typeof import('@/server/modules/core/reference');
type Ctx = Parameters<Reference['getReference']>[0];
let reference: Reference;

function ctxFor(userId: string, mfaVerifiedAt: Date | null = new Date(), tenant = tenantId): Ctx {
  return { tenantId: tenant, userId, sessionId: uuidv7(), deviceId: null, mfaVerifiedAt };
}

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) ? error.code : error).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

async function seedTenant(id: string, code: string, users: [string, string[]][]) {
  await withSystem(handle.db, (t) =>
    t.insert(schema.tenant).values({
      id,
      code,
      legalName: 'Structure de test référentiels',
      displayName: 'Structure de test référentiels',
      type: 'clinic',
      status: 'active',
    }),
  );
  await withTenant(handle.db, { tenantId: id, userId: null }, async (t) => {
    for (const [userId, permissions] of users) {
      const roleId = uuidv7();
      await t
        .insert(schema.role)
        .values({ id: roleId, tenantId: id, code: `r${userId.slice(-6)}`, name: 'Rôle' });
      if (permissions.length > 0) {
        await t
          .insert(schema.rolePermission)
          .values(permissions.map((permissionKey) => ({ tenantId: id, roleId, permissionKey })));
      }
      await t.insert(schema.userAccount).values({
        id: userId,
        tenantId: id,
        username: `u${userId.slice(-6)}`,
        displayName: 'Utilisateur fictif',
        passwordHash: 'x',
      });
      await t.insert(schema.userRole).values({ id: uuidv7(), tenantId: id, userId, roleId });
    }
    await t
      .insert(schema.site)
      .values({ id: uuidv7(), tenantId: id, code: 'KIN', name: 'Site de Kinshasa' });
  });
}

describe.skipIf(!url)('reference catalogs against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    reference = await import('@/server/modules/core/reference');
    handle = createDb(url as string, 4);
    await seedTenant(tenantId, `TST-REF-${suffix}`, [
      [adminId, ['configuration:read', 'configuration:edit']],
      [clerkId, ['patient:read']],
    ]);
    await seedTenant(otherTenantId, `TST-REO-${suffix}`, [[uuidv7(), ['configuration:read']]]);
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  let listId = '';

  it('serves the platform catalogs: currencies, UCUM units and the 26 provinces', async () => {
    const overview = await reference.getReference(ctxFor(adminId, null));
    expect(overview.currencies.map((c) => [c.code, c.minorUnit])).toEqual([
      ['CDF', 2],
      ['USD', 2],
    ]);
    expect(overview.units.some((u) => u.code === 'mm[Hg]')).toBe(true);
    expect(overview.provinces).toHaveLength(DRC_PROVINCES.length);
    expect(overview.areas.find((a) => a.kind === 'province')?.count).toBe(26);
    await expectCode(reference.getReference(ctxFor(clerkId)), 'PERMISSION_DENIED');
  });

  it('creates a pick list, simulates an import and saves the items', async () => {
    await expectCode(
      reference.createChoiceList(
        ctxFor(adminId, null),
        { code: 'ARRIVEE', nameFr: "Mode d'arrivée" },
        client,
      ),
      'AUTH_STEP_UP_REQUIRED',
    );
    ({ listId } = await reference.createChoiceList(
      ctxFor(adminId),
      { code: 'ARRIVEE', nameFr: "Mode d'arrivée" },
      client,
    ));
    await expectCode(
      reference.createChoiceList(ctxFor(adminId), { code: 'ARRIVEE', nameFr: 'Doublon' }, client),
      'REF_LIST_CODE_TAKEN',
    );

    const simulated = await reference.simulateChoiceImport(ctxFor(adminId, null), {
      listId,
      csv: 'code;libellé;libellé_en\nPIED;À pied;On foot\nTAXI;Taxi;Taxi\n;Sans code;\n',
    });
    expect(simulated.items.map((i) => i.code)).toEqual(['PIED', 'TAXI']);
    expect(simulated.errors).toEqual([{ line: 4, field: 'code', problem: 'invalid' }]);
    const before = await reference.getReference(ctxFor(adminId));
    expect(before.choiceLists.find((l) => l.id === listId)?.items).toEqual([]);

    expect(
      await reference.saveChoiceItems(ctxFor(adminId), { listId, items: simulated.items }, client),
    ).toEqual({ added: 2, updated: 0, deactivated: 0 });
  });

  it('deactivates instead of deleting, and keeps codes stable', async () => {
    const result = await reference.saveChoiceItems(
      ctxFor(adminId),
      {
        listId,
        items: [
          { code: 'PIED', labelFr: 'À pied', labelEn: 'On foot', sortOrder: 5, isActive: true },
          { code: 'AMB', labelFr: 'Ambulance', labelEn: null, sortOrder: 30, isActive: true },
        ],
      },
      client,
    );
    expect(result).toEqual({ added: 1, updated: 1, deactivated: 1 });
    const rows = await withTenant(handle.db, { tenantId, userId: null }, (t) =>
      t.select().from(schema.choiceItem).where(eq(schema.choiceItem.listId, listId)),
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.code === 'TAXI')?.isActive).toBe(false);
  });

  it('gives devices a snapshot with an etag, without inactive items or other structures', async () => {
    const snapshot = await reference.catalogSnapshot(ctxFor(clerkId));
    expect(snapshot.sites.map((s) => s.code)).toEqual(['KIN']);
    expect(snapshot.choiceLists).toEqual([
      {
        code: 'ARRIVEE',
        nameFr: "Mode d'arrivée",
        nameEn: null,
        items: [
          { code: 'PIED', labelFr: 'À pied', labelEn: 'On foot' },
          { code: 'AMB', labelFr: 'Ambulance', labelEn: null },
        ],
      },
    ]);
    expect((await reference.catalogSnapshot(ctxFor(clerkId))).etag).toBe(snapshot.etag);
    const other = await reference.catalogSnapshot(ctxFor(uuidv7(), new Date(), otherTenantId));
    expect(other.choiceLists).toEqual([]);
    expect(other.etag).not.toBe(snapshot.etag);

    await reference.updateChoiceList(
      ctxFor(adminId),
      { listId, nameFr: "Mode d'arrivée", nameEn: 'Arrival mode', isActive: false },
      client,
    );
    const after = await reference.catalogSnapshot(ctxFor(clerkId));
    expect(after.choiceLists).toEqual([]);
    expect(after.etag).not.toBe(snapshot.etag);
  });

  it('audits every change in a valid chain', async () => {
    const audit = await withTenant(handle.db, { tenantId, userId: null }, (t) =>
      t.select({ action: schema.auditLog.action }).from(schema.auditLog),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'choice_items_save',
      'choice_items_save',
      'choice_list_create',
      'choice_list_update',
    ]);
    const chain = await withTenant(handle.db, { tenantId, userId: null }, (t) =>
      verifyAuditChain(t, tenantId),
    );
    expect(chain.ok).toBe(true);
  });
});
