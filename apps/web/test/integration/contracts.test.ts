import { resolve } from 'node:path';
import { PLAN_B } from '@medhub/conventions';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgSyncStore } from '@/server/modules/sync';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const userId = uuidv7();
const PERMISSIONS = [
  'patient:create',
  'patient:read',
  'contract:read',
  'contract:create',
  'contract:update',
  'contract:activate',
  'beneficiary:read',
  'beneficiary:import',
];

let handle: DbHandle;
type Conv = typeof import('@/server/modules/conv/service');
let conv: Conv;
const ctx = () => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});
const client = { ip: null };
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

function workstation() {
  const deviceId = uuidv7();
  const permissions = new Set(PERMISSIONS);
  const store = pgSyncStore(handle.db, { tenantId, userId, deviceId });
  const syncCtx = {
    tenantId,
    userId,
    deviceId,
    permissions,
    devicePublicKey: null,
    serverTime: () => new Date().toISOString(),
  };
  const transport: SyncTransport = {
    push: async (req) =>
      JSON.parse(
        JSON.stringify(await processPush(store, syncCtx, JSON.parse(JSON.stringify(req)))),
      ),
    pull: async () => ({ changes: [], nextCursor: 0, hasMore: false, serverTime: toIso(0) }),
  };
  return new SyncClient({
    store: new MemoryClientStore(),
    transport,
    clock: new ManualClock(Date.now()),
    identity: { tenantId, siteId: null, userId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions,
  });
}

const LIST = [
  'matricule;famille;nom;role;plan;debut;journalier',
  'AG-01;;Ilunga Marc;titulaire;B;2026-01-01;non',
  'AG-01-1;AG-01;Ilunga Sarah;conjoint;B;2026-01-01;non',
  'AG-02;;Kasongo Paul;titulaire;B;2026-02-01;non',
  'JR-01;;Mbala Eric;titulaire;B;2026-03-01;oui',
].join('\n');

describe.skipIf(!url)('contracts and beneficiaries against PostgreSQL', () => {
  let contractId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    conv = await import('@/server/modules/conv/service');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-CNV-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test conventions',
        displayName: 'Structure de test conventions',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tenantTx(async (tx) => {
      const roleId = uuidv7();
      await tx.insert(schema.role).values({ id: roleId, tenantId, code: 'dir', name: 'Direction' });
      await tx
        .insert(schema.rolePermission)
        .values(PERMISSIONS.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
      await tx.insert(schema.userAccount).values({
        id: userId,
        tenantId,
        username: 'dir',
        displayName: 'Direction',
        passwordHash: 'x',
      });
      await tx.insert(schema.userRole).values({ id: uuidv7(), tenantId, userId, roleId });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('activates a contract only with a published plan, and freezes published rules', async () => {
    const { id: payerId } = await conv.savePayer(
      ctx(),
      {
        code: 'ENT',
        name: 'Entreprise Test SARL',
        kind: 'company',
        contact: {},
        paymentTermDays: 30,
        isActive: true,
      },
      client,
    );
    ({ id: contractId } = await conv.saveContract(
      ctx(),
      {
        payerId,
        code: 'ENT-2026',
        name: 'Convention test',
        currency: 'USD',
        validFrom: '2026-01-01',
        invoiceDay: 25,
      },
      client,
    ));
    await expect(
      conv.setContractStatus(ctx(), { id: contractId, status: 'active' }, client),
    ).rejects.toMatchObject({
      code: 'CONV_PLAN_INVALID',
    });
    await expect(
      conv.savePlanDraft(ctx(), { contractId, rules: { code: 'B' } }, client),
    ).rejects.toMatchObject({
      code: 'CONV_PLAN_INVALID',
    });
    const draft = await conv.savePlanDraft(ctx(), { contractId, rules: PLAN_B }, client);
    expect(draft.version).toBe(1);
    await conv.publishPlan(ctx(), { contractId, code: 'B' }, client);
    await conv.setContractStatus(ctx(), { id: contractId, status: 'active' }, client);
    await expect(
      tenantTx((tx) =>
        tx
          .update(schema.contractPlan)
          .set({ rules: { code: 'X' } })
          .where(eq(schema.contractPlan.id, draft.id)),
      ),
    ).rejects.toThrow();
    const next = await conv.savePlanDraft(
      ctx(),
      { contractId, rules: { ...PLAN_B, price: 8000 } },
      client,
    );
    expect(next.version).toBe(2);
  });

  it('compares the payer file with the list held, then applies entries, changes and exits', async () => {
    const report = await conv.importBeneficiaries(
      ctx(),
      { contractId, csv: LIST, apply: false, completeList: true, effectiveOn: '2026-11-01' },
      client,
    );
    expect(report).toMatchObject({ errors: [], entries: 4, changes: 0, exits: 0, total: 0 });
    await conv.importBeneficiaries(
      ctx(),
      { contractId, csv: LIST, apply: true, completeList: true, effectiveOn: '2026-11-01' },
      client,
    );

    const update = [
      'matricule;famille;nom;role;plan;debut;journalier',
      'AG-01;;Ilunga Marc;titulaire;B;2026-01-01;non',
      'AG-01-1;AG-01;Ilunga Sarah Mujinga;conjoint;B;2026-01-01;non',
      'JR-01;;Mbala Eric;titulaire;B;2026-03-01;oui',
      'AG-03;;Tshiala Ruth;titulaire;Z;2026-11-01;non',
    ].join('\n');
    const checked = await conv.importBeneficiaries(
      ctx(),
      { contractId, csv: update, apply: false, completeList: true, effectiveOn: '2026-11-01' },
      client,
    );
    expect(checked.errors).toEqual([{ line: 5, message: 'CONV_IMPORT_UNKNOWN_PLAN' }]);
    const fixed = update.replace(';Z;', ';B;');
    expect(
      await conv.importBeneficiaries(
        ctx(),
        { contractId, csv: fixed, apply: true, completeList: true, effectiveOn: '2026-11-15' },
        client,
      ),
    ).toMatchObject({ entries: 1, changes: 1, exits: 1, total: 4 });

    const rows = await conv.listBeneficiaries(ctx(), contractId);
    expect(rows.find((r) => r.memberNumber === 'AG-02')).toMatchObject({
      status: 'left',
      validUntil: '2026-11-15',
    });
    expect(rows.find((r) => r.memberNumber === 'AG-01-1')?.fullName).toBe('Ilunga Sarah Mujinga');
    expect(rows.find((r) => r.memberNumber === 'JR-01')?.isDayLaborer).toBe(true);
    const [movements] = await tenantTx((tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.beneficiaryMovement),
    );
    expect(movements?.n).toBe(7);

    const catalog = await tenantTx((tx) => conv.conventionsCatalog(tx));
    expect(catalog.contracts.map((c) => c.payerName)).toEqual(['Entreprise Test SARL']);
    expect(catalog.plans.map((p) => p.version)).toEqual([1]);
    expect(catalog.beneficiaries.map((b) => b.memberNumber).sort()).toEqual([
      'AG-01',
      'AG-01-1',
      'AG-03',
      'JR-01',
    ]);
  });

  it('links a patient to a beneficiary offline and refuses an unknown member', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-CNV-1',
      familyName: 'Ilunga',
      sex: 'M',
    });
    const members = await conv.listBeneficiaries(ctx(), contractId);
    const marc = members.find((m) => m.memberNumber === 'AG-01')!;
    await d.dispatch('patient_coverage.link', {
      patientId,
      contractId,
      beneficiaryId: marc.id,
      linkedAt: new Date().toISOString(),
    });
    const wrong = await d.dispatch('patient_coverage.link', {
      patientId,
      contractId,
      beneficiaryId: uuidv7(),
      linkedAt: new Date().toISOString(),
    });
    await d.sync();
    const links = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.patientCoverage)
        .where(eq(schema.patientCoverage.patientId, patientId)),
    );
    expect(links).toMatchObject([{ beneficiaryId: marc.id, status: 'active' }]);
    const [op] = await tenantTx((tx) =>
      tx
        .select({ reason: sql<string>`${schema.opLog.result}->>'reason'` })
        .from(schema.opLog)
        .where(eq(schema.opLog.entityId, wrong.entityId)),
    );
    expect(op?.reason).toBe('CONV_BENEFICIARY_UNKNOWN');
  });
});
