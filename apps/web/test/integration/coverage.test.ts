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
  'invoice:read',
  'invoice:create',
  'invoice:add_line',
  'invoice:finalize',
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
const reasonOf = (entityId: string) =>
  tenantTx(async (tx) => {
    const [row] = await tx
      .select({ reason: sql<string>`${schema.opLog.result}->>'reason'` })
      .from(schema.opLog)
      .where(eq(schema.opLog.entityId, entityId));
    return row?.reason ?? null;
  });

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

describe.skipIf(!url)('coverage of invoice lines against PostgreSQL', () => {
  let contractId = '';
  let memberId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    conv = await import('@/server/modules/conv/service');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-COV-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test couverture',
        displayName: 'Structure de test couverture',
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
    const { id: payerId } = await conv.savePayer(
      ctx(),
      {
        code: 'ENT',
        name: 'Entreprise Test',
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
        code: 'ENT-COV',
        name: 'Convention',
        currency: 'USD',
        validFrom: '2026-01-01',
        invoiceDay: 25,
      },
      client,
    ));
    await conv.savePlanDraft(ctx(), { contractId, rules: PLAN_B }, client);
    await conv.publishPlan(ctx(), { contractId, code: 'B' }, client);
    await conv.setContractStatus(ctx(), { id: contractId, status: 'active' }, client);
    await conv.importBeneficiaries(
      ctx(),
      {
        contractId,
        csv: 'matricule;nom;plan;debut\nAG-01;Ilunga Marc;B;2026-01-01',
        apply: true,
        completeList: false,
        effectiveOn: '2026-11-01',
      },
      client,
    );
    memberId = (await conv.listBeneficiaries(ctx(), contractId))[0]!.id;
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('stores the payer share with its trace, only for a patient linked to the contract', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-COV-1',
      familyName: 'Ilunga',
      sex: 'M',
    });
    const { entityId: other } = await d.dispatch('patient.register', {
      mrn: 'TST-COV-2',
      familyName: 'Kanku',
      sex: 'F',
    });
    await d.dispatch('patient_coverage.link', {
      patientId,
      contractId,
      beneficiaryId: memberId,
      linkedAt: new Date().toISOString(),
    });
    const { entityId: voucherId } = await d.dispatch('referral_voucher.register', {
      patientId,
      contractId,
      beneficiaryId: memberId,
      number: 'BE-001',
      signatory: 'Service du personnel',
      issuedOn: '2026-11-01',
      validUntil: '2026-11-30',
      registeredAt: new Date().toISOString(),
    });
    const twice = await d.dispatch('referral_voucher.register', {
      patientId,
      contractId,
      beneficiaryId: memberId,
      number: 'BE-001',
      signatory: 'Service du personnel',
      issuedOn: '2026-11-01',
      validUntil: '2026-11-30',
      registeredAt: new Date().toISOString(),
    });
    const line = (invoiceId: string, pid: string, over: Record<string, unknown> = {}) => ({
      invoiceId,
      patientId: pid,
      label: 'Consultation générale',
      category: 'consultation' as const,
      quantity: 1,
      unitPrice: 900,
      currency: 'USD',
      performedAt: new Date().toISOString(),
      payerShare: 900,
      contractId,
      beneficiaryId: memberId,
      coverage: {
        decision: 'covered',
        planCode: 'B',
        ruleVersion: 'p@1',
        matchedRule: 'plateau-semi-complet',
      },
      ...over,
    });
    const inv = await d.dispatch('invoice.open', {
      patientId,
      currency: 'USD',
      number: `FAC-COV-${String(Date.now())}1`,
      openedAt: new Date().toISOString(),
    });
    const { entityId: covered } = await d.dispatch(
      'invoice.add_line',
      line(inv.entityId, patientId),
      { dependsOn: [inv.opId] },
    );
    const inv2 = await d.dispatch('invoice.open', {
      patientId: other,
      currency: 'USD',
      number: `FAC-COV-${String(Date.now())}2`,
      openedAt: new Date().toISOString(),
    });
    const { entityId: stranger } = await d.dispatch(
      'invoice.add_line',
      line(inv2.entityId, other),
      { dependsOn: [inv2.opId] },
    );
    await d.sync();

    expect(await reasonOf(twice.entityId)).toBe('CONV_VOUCHER_NUMBER_TAKEN');
    expect(await reasonOf(stranger)).toBe('FACT_COVERAGE_WITHOUT_CONTRACT');
    const [row] = await tenantTx((tx) =>
      tx.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.id, covered)),
    );
    expect(row).toMatchObject({
      payerShare: 900,
      contractId,
      beneficiaryId: memberId,
      coverage: { planCode: 'B', ruleVersion: 'p@1' },
    });
    expect(voucherId).toBeTruthy();

    // The same act evaluated again replaces the line while the invoice is open...
    const { entityId: again } = await d.dispatch(
      'invoice.add_line',
      line(inv.entityId, patientId, {
        payerShare: 0,
        coverage: { decision: 'not_covered', reasons: ['CONV_BILLED_TO_PATIENT'] },
        supersedesId: covered,
        reevaluation: true,
      }),
    );
    await d.sync();
    const rows = await tenantTx((tx) =>
      tx.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, inv.entityId)),
    );
    expect(rows.find((r) => r.id === covered)?.status).toBe('superseded');
    expect(rows.find((r) => r.id === again)).toMatchObject({ status: 'active', payerShare: 0 });

    // ...and no longer once it is finalized.
    await d.dispatch(
      'invoice.finalize',
      { status: 'finalized', finalizedAt: new Date().toISOString() },
      { entityId: inv.entityId },
    );
    const late = await d.dispatch(
      'invoice.add_line',
      line(inv.entityId, patientId, { supersedesId: again, reevaluation: true }),
    );
    await d.sync();
    expect(await reasonOf(late.entityId)).toBe('FACT_LINE_NOT_REPLACEABLE');
  });

  it('covers an emergency on the service card and regularises it with a voucher', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-COV-3',
      familyName: 'Ilunga',
      sex: 'M',
    });
    await d.dispatch('patient_coverage.link', {
      patientId,
      contractId,
      beneficiaryId: memberId,
      linkedAt: new Date().toISOString(),
    });
    const now = new Date();
    const { entityId: exceptionId } = await d.dispatch('coverage.emergency_override', {
      patientId,
      contractId,
      reason: 'Urgence de nuit, carte de service présentée',
      recordedAt: now.toISOString(),
      dueBy: new Date(now.getTime() + 72 * 3_600_000).toISOString(),
    });
    const { entityId: voucherId } = await d.dispatch('referral_voucher.register', {
      patientId,
      contractId,
      beneficiaryId: memberId,
      number: 'BE-002',
      signatory: 'Service du personnel',
      issuedOn: '2026-11-07',
      validUntil: '2026-11-14',
      registeredAt: new Date().toISOString(),
    });
    await d.dispatch(
      'coverage_exception.regularize',
      { status: 'regularized', voucherId },
      { entityId: exceptionId },
    );
    await d.sync();
    const [row] = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.coverageException)
        .where(eq(schema.coverageException.id, exceptionId)),
    );
    expect(row).toMatchObject({ status: 'regularized', voucherId });
  });
});
