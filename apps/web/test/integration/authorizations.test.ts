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
  'prior_authorization:read',
  'prior_authorization:request',
  'prior_authorization:decide',
  'payer_invoice:record_payment',
];

let handle: DbHandle;
type Conv = typeof import('@/server/modules/conv/service');
type Auth = typeof import('@/server/modules/conv/authorizations');
let conv: Conv;
let auth: Auth;
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

describe.skipIf(!url)('prior authorizations and guarantees against PostgreSQL', () => {
  let contractId = '';
  let draftContractId = '';
  let memberId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    conv = await import('@/server/modules/conv/service');
    auth = await import('@/server/modules/conv/authorizations');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-AUT-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test accords',
        displayName: 'Structure de test accords',
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
    const agreement = (code: string) =>
      conv.saveContract(
        ctx(),
        { payerId, code, name: code, currency: 'USD', validFrom: '2026-01-01', invoiceDay: 25 },
        client,
      );
    ({ id: contractId } = await agreement('ENT-PA'));
    ({ id: draftContractId } = await agreement('ENT-PA-DRAFT'));
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

  it('asks offline, decides once online and keeps the decision fixed', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-PA-1',
      familyName: 'Ilunga',
      sex: 'M',
    });
    const request = (over: Record<string, unknown> = {}) => ({
      patientId,
      contractId,
      beneficiaryId: memberId,
      serviceItemId: uuidv7(),
      serviceCode: 'IMG-SCAN',
      label: 'Scanner',
      currency: 'USD',
      amountRequested: 15000,
      reason: 'Traumatisme crânien, scanner demandé',
      requestedAt: new Date().toISOString(),
      status: 'pending' as const,
      ...over,
    });
    const { entityId: asked } = await d.dispatch('prior_authorization.request', request());
    const refused = await d.dispatch(
      'prior_authorization.request',
      request({ contractId: draftContractId }),
    );
    await d.sync();
    expect(await reasonOf(refused.entityId)).toBe('CONV_CONTRACT_NOT_ACTIVE');

    const queue = await auth.listPriorAuthorizations(ctx());
    expect(queue.canDecide).toBe(true);
    expect(queue.requests.find((r) => r.id === asked)).toMatchObject({
      status: 'pending' as const,
      memberNumber: 'AG-01',
    });

    await auth.decidePriorAuthorization(
      ctx(),
      { id: asked, approve: true, authorizedAmount: 12000, validUntil: '2026-12-31' },
      client,
    );
    const [row] = await tenantTx((tx) =>
      tx.select().from(schema.priorAuthorization).where(eq(schema.priorAuthorization.id, asked)),
    );
    expect(row).toMatchObject({ status: 'approved', authorizedAmount: 12000, version: 2 });
    const changes = await tenantTx((tx) =>
      tx.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, asked)),
    );
    expect(changes.some((c) => c.version === 2)).toBe(true);

    await expect(
      auth.decidePriorAuthorization(ctx(), { id: asked, approve: false, note: 'Refus' }, client),
    ).rejects.toMatchObject({ code: 'FACT_ALREADY_DECIDED' });
    await expect(
      tenantTx((tx) =>
        tx
          .update(schema.priorAuthorization)
          .set({ authorizedAmount: 99999 })
          .where(eq(schema.priorAuthorization.id, asked)),
      ),
    ).rejects.toThrow();
  });

  it('never refunds more guarantee than held', async () => {
    const record = (kind: 'receive' | 'refund', amount: number) =>
      auth.recordGuarantee(
        ctx(),
        { contractId, memberNumber: 'AG-01', kind, amount, currency: 'USD', method: 'transfer' },
        client,
      );
    await record('receive', 7500);
    await expect(record('refund', 10000)).rejects.toMatchObject({
      code: 'CONV_GUARANTEE_TOO_HIGH',
    });
    await record('refund', 7500);
    const { rows, balance } = await auth.listGuarantees(ctx(), contractId);
    expect(rows).toHaveLength(2);
    expect(balance.total).toBe(0);
  });
});
