import { resolve } from 'node:path';
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
const cashierId = uuidv7();
const directorId = uuidv7();
let cashierRole = '';
const CASHIER = [
  'patient:create',
  'patient:read',
  'invoice:read',
  'invoice:create',
  'invoice:add_line',
  'invoice:finalize',
  'invoice:discount',
  'invoice:void',
  'payment:read',
  'payment:receive',
  'payment:refund',
  'cash_session:open',
];

let handle: DbHandle;
type Approvals = typeof import('@/server/modules/fact/approvals');
let approvals: Approvals;
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);
const ctxOf = (userId: string) => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});

function workstation() {
  const deviceId = uuidv7();
  const permissions = new Set(CASHIER);
  const store = pgSyncStore(handle.db, { tenantId, userId: cashierId, deviceId });
  const syncCtx = {
    tenantId,
    userId: cashierId,
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
    identity: { tenantId, siteId: null, userId: cashierId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions,
  });
}

const reasonOf = (entityId: string) =>
  tenantTx(async (tx) => {
    const [row] = await tx
      .select({ reason: sql<string>`${schema.opLog.result}->>'reason'` })
      .from(schema.opLog)
      .where(eq(schema.opLog.entityId, entityId));
    return row?.reason ?? null;
  });

async function billed(d: SyncClient, amount: number) {
  const { entityId: patientId } = await d.dispatch('patient.register', {
    mrn: `TST-ADJ-${String(Math.floor(Math.random() * 1e6))}`,
    familyName: 'Kabongo',
    sex: 'M',
  });
  const invoice = await d.dispatch('invoice.open', {
    patientId,
    currency: 'USD',
    number: `FAC-KIN-AC-2026-${String(Math.floor(Math.random() * 9e6) + 1e6)}`,
    openedAt: new Date().toISOString(),
  });
  await d.dispatch(
    'invoice.add_line',
    {
      invoiceId: invoice.entityId,
      patientId,
      label: 'Consultation générale',
      category: 'consultation',
      quantity: 1,
      unitPrice: amount,
      currency: 'USD',
      performedAt: new Date().toISOString(),
    },
    { dependsOn: [invoice.opId] },
  );
  return { patientId, invoiceId: invoice.entityId };
}

const request = (
  kind: 'discount' | 'credit_note',
  invoiceId: string,
  patientId: string,
  amount: number,
) => ({
  invoiceId,
  patientId,
  currency: 'USD',
  amount,
  reason: kind === 'discount' ? 'Patient indigent reconnu' : 'Visite annulée',
  requestedAt: new Date().toISOString(),
});

describe.skipIf(!url)('discounts and credit notes against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    approvals = await import('@/server/modules/fact/approvals');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-ADJ-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test remises',
        displayName: 'Structure de test remises',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tenantTx(async (tx) => {
      cashierRole = uuidv7();
      const directorRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: cashierRole, tenantId, code: 'cais', name: 'Caissier' },
        { id: directorRole, tenantId, code: 'dir', name: 'Direction' },
      ]);
      await tx
        .insert(schema.rolePermission)
        .values([
          ...CASHIER.map((permissionKey) => ({ tenantId, roleId: cashierRole, permissionKey })),
          { tenantId, roleId: cashierRole, permissionKey: 'approval:decide' },
          { tenantId, roleId: directorRole, permissionKey: 'approval:decide' },
          { tenantId, roleId: directorRole, permissionKey: 'invoice:read' },
          { tenantId, roleId: directorRole, permissionKey: 'role:manage' },
        ]);
      await tx.insert(schema.userAccount).values([
        { id: cashierId, tenantId, username: 'caisse', displayName: 'Caissier', passwordHash: 'x' },
        {
          id: directorId,
          tenantId,
          username: 'direction',
          displayName: 'Direction',
          passwordHash: 'x',
        },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: cashierId, roleId: cashierRole },
        { id: uuidv7(), tenantId, userId: directorId, roleId: directorRole },
      ]);
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('keeps a discount pending until another person approves it', async () => {
    const d = workstation();
    const { patientId, invoiceId } = await billed(d, 1000);
    const { entityId: requestId } = await d.dispatch(
      'discount.request',
      request('discount', invoiceId, patientId, 300),
    );
    const { entityId: tooHigh } = await d.dispatch(
      'discount.request',
      request('discount', invoiceId, patientId, 1500),
    );
    await d.sync();
    expect(await reasonOf(tooHigh)).toBe('FACT_ADJUSTMENT_TOO_HIGH');
    const [pending] = await tenantTx((tx) =>
      tx.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)),
    );
    expect(pending?.status).toBe('pending');

    // The cashier cannot approve their own request, even with the permission.
    await expect(
      approvals.decideApproval(ctxOf(cashierId), { id: requestId, approve: true }, { ip: null }),
    ).rejects.toMatchObject({ code: 'FACT_SAME_APPROVER' });
    await approvals.decideApproval(
      ctxOf(directorId),
      { id: requestId, approve: true },
      { ip: null },
    );
    await expect(
      approvals.decideApproval(ctxOf(directorId), { id: requestId, approve: true }, { ip: null }),
    ).rejects.toMatchObject({ code: 'FACT_ALREADY_DECIDED' });

    const grants = await tenantTx((tx) =>
      tx.select().from(schema.discountGrant).where(eq(schema.discountGrant.invoiceId, invoiceId)),
    );
    expect(grants).toMatchObject([{ amount: 300, approvedBy: directorId }]);
    const changes = await tenantTx((tx) =>
      tx.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, grants[0]!.id)),
    );
    expect(changes).toHaveLength(1);
    const listed = await approvals.listApprovals(ctxOf(directorId));
    expect(listed.requests.find((r) => r.id === requestId)).toMatchObject({
      status: 'approved',
      requestedBy: 'Caissier',
      decidedBy: 'Direction',
    });
  });

  it('voids an invoice credited in full, and grants below the cap of the role at once', async () => {
    const d = workstation();
    const { patientId, invoiceId } = await billed(d, 1000);
    const { entityId: creditId } = await d.dispatch(
      'credit_note.request',
      request('credit_note', invoiceId, patientId, 1000),
    );
    await d.sync();
    await expect(
      approvals.decideApproval(ctxOf(directorId), { id: creditId, approve: false }, { ip: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await approvals.decideApproval(
      ctxOf(directorId),
      { id: creditId, approve: true },
      { ip: null },
    );
    const [credit] = await tenantTx((tx) =>
      tx.select().from(schema.creditNote).where(eq(schema.creditNote.invoiceId, invoiceId)),
    );
    expect(credit?.number).toMatch(/^AV-\d{4}-\d{6}$/);
    const [invoice] = await tenantTx((tx) =>
      tx.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId)),
    );
    expect(invoice?.status).toBe('voided');

    await approvals.saveApprovalThreshold(
      ctxOf(directorId),
      { roleId: cashierRole, kind: 'discount', currency: 'USD', maxAmount: 200 },
      { ip: null },
    );
    const second = await billed(d, 1000);
    const { entityId: small } = await d.dispatch(
      'discount.request',
      request('discount', second.invoiceId, second.patientId, 150),
    );
    const { entityId: large } = await d.dispatch(
      'discount.request',
      request('discount', second.invoiceId, second.patientId, 250),
    );
    await d.sync();
    const rows = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.approvalRequest)
        .where(eq(schema.approvalRequest.invoiceId, second.invoiceId)),
    );
    expect(rows.find((r) => r.id === small)).toMatchObject({
      status: 'approved',
      decisionReason: 'auto',
    });
    expect(rows.find((r) => r.id === large)?.status).toBe('pending');
  });

  it('refunds with a payment of the opposite sign and a reason', async () => {
    const d = workstation();
    const { patientId, invoiceId } = await billed(d, 1000);
    const { entityId: sessionId } = await d.dispatch('cash_session.open', {
      openedAt: new Date().toISOString(),
      openingFloat: { USD: 0 },
    });
    const base = {
      patientId,
      invoiceId,
      cashSessionId: sessionId,
      method: 'cash' as const,
      currency: 'USD',
      invoiceCurrency: 'USD',
      exchangeRate: null,
      exchangeRateDate: null,
      receivedAt: new Date().toISOString(),
    };
    await d.dispatch('payment.receive', {
      ...base,
      amount: 1000,
      amountInInvoiceCurrency: 1000,
      receiptNumber: `REC-T-${String(Date.now())}1`,
    });
    await expect(
      d.dispatch('payment.receive', {
        ...base,
        amount: -300,
        amountInInvoiceCurrency: -300,
        refundReason: 'Trop perçu',
        receiptNumber: `REC-T-${String(Date.now())}2`,
      }),
    ).rejects.toMatchObject({ code: 'FACT_REFUND_NOT_ALLOWED' });
    await d.dispatch('payment.refund', {
      ...base,
      amount: -300,
      amountInInvoiceCurrency: -300,
      refundReason: 'Trop perçu',
      receiptNumber: `REC-T-${String(Date.now())}3`,
    });
    await d.sync();
    const payments = await tenantTx((tx) =>
      tx.select().from(schema.payment).where(eq(schema.payment.invoiceId, invoiceId)),
    );
    expect(payments.map((p) => p.amount).sort((a, b) => a - b)).toEqual([-300, 1000]);
  });
});
