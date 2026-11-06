import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { quote, rateFor, settlement } from '@medhub/domain';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgSyncStore } from '@/server/modules/sync';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const userId = uuidv7();
const CASHIER = [
  'patient:create',
  'patient:read',
  'invoice:read',
  'invoice:create',
  'invoice:add_line',
  'invoice:finalize',
  'payment:read',
  'payment:receive',
  'cash_session:open',
  'cash_session:close',
];

let handle: DbHandle;
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

function workstation() {
  const deviceId = uuidv7();
  const permissions = new Set(CASHIER);
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

const reasonOf = (entityId: string) =>
  tenantTx(async (tx) => {
    const [row] = await tx
      .select({ reason: sql<string>`${schema.opLog.result}->>'reason'` })
      .from(schema.opLog)
      .where(eq(schema.opLog.entityId, entityId));
    return row?.reason ?? null;
  });

let receipt = 0;
const receiptNumber = () => `REC-KIN-AA-2026-${String(Date.now()).slice(-6)}${receipt++}`;

async function billedPatient(d: SyncClient, amount: number) {
  const { entityId: patientId } = await d.dispatch('patient.register', {
    mrn: `TST-CSH-${String(Math.floor(Math.random() * 1e6))}`,
    familyName: 'Mbuyi',
    sex: 'F',
  });
  const invoice = await d.dispatch('invoice.open', {
    patientId,
    currency: 'USD',
    number: `FAC-KIN-AA-2026-${String(Math.floor(Math.random() * 9e6) + 1e6)}`,
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

describe.skipIf(!url)('payments and cash sessions against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-CSH-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test caisse',
        displayName: 'Structure de test caisse',
        type: 'clinic',
        status: 'active',
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('pays a USD invoice in CDF cash offline, then closes the session with a justified variance', async () => {
    const d = workstation();
    const { entityId: sessionId } = await d.dispatch('cash_session.open', {
      openedAt: new Date().toISOString(),
      openingFloat: { CDF: 1_000_000, USD: 0 },
    });
    const { patientId, invoiceId } = await billedPatient(d, 1200);
    const choice = rateFor(
      [{ from: 'USD', to: 'CDF', rate: '2865.5', validFrom: '2026-11-05' }],
      'USD',
      'CDF',
      '2026-11-06',
    )!;
    const q = quote(1200, 'USD', 'CDF', choice, 'cash', 5000);
    const s = settlement(3_500_000, q, 1200, 'USD', 'CDF', choice);
    await d.dispatch('payment.receive', {
      patientId,
      invoiceId,
      cashSessionId: sessionId,
      method: 'cash',
      currency: 'CDF',
      amount: s.amount,
      invoiceCurrency: 'USD',
      amountInInvoiceCurrency: s.amountInInvoiceCurrency,
      exchangeRate: choice.rate,
      exchangeRateDate: choice.validFrom,
      exchangeRateInverse: false,
      roundingAdjustment: s.roundingAdjustment,
      change: s.change,
      receiptNumber: receiptNumber(),
      receivedAt: new Date().toISOString(),
    });
    await d.dispatch(
      'cash_session.close',
      {
        status: 'closed',
        closedAt: new Date().toISOString(),
        expected: { CDF: 4_440_000, USD: 0 },
        counted: { CDF: 4_430_000, USD: 0 },
        justification: 'Billet de 100 FC manquant',
      },
      { entityId: sessionId },
    );
    await d.sync();

    const [paid] = await tenantTx((tx) =>
      tx.select().from(schema.payment).where(eq(schema.payment.invoiceId, invoiceId)),
    );
    expect(paid).toMatchObject({
      amount: 3_440_000,
      amountInInvoiceCurrency: 1200,
      roundingAdjustment: 1400,
      change: 60_000,
      exchangeRate: '2865.500000',
    });
    const [session] = await tenantTx((tx) =>
      tx.select().from(schema.cashSession).where(eq(schema.cashSession.id, sessionId)),
    );
    expect(session).toMatchObject({
      status: 'closed',
      serverExpected: { CDF: 4_440_000, USD: 0 },
      counted: { CDF: 4_430_000, USD: 0 },
    });

    // Closed for good: no reopening, not even by a direct statement.
    await expect(
      tenantTx((tx) =>
        tx
          .update(schema.cashSession)
          .set({ status: 'open' })
          .where(eq(schema.cashSession.id, sessionId)),
      ),
    ).rejects.toThrow();
    await expect(
      tenantTx((tx) =>
        tx.update(schema.payment).set({ amount: 1 }).where(eq(schema.payment.invoiceId, invoiceId)),
      ),
    ).rejects.toThrow();

    // A payment in the closed session is refused.
    const late = await d.dispatch('payment.receive', {
      patientId,
      invoiceId,
      cashSessionId: sessionId,
      method: 'cash',
      currency: 'USD',
      amount: 100,
      invoiceCurrency: 'USD',
      amountInInvoiceCurrency: 100,
      exchangeRate: null,
      exchangeRateDate: null,
      receiptNumber: receiptNumber(),
      receivedAt: new Date().toISOString(),
    });
    await d.sync();
    expect(await reasonOf(late.entityId)).toBe('FACT_SESSION_CLOSED');
  });

  it('refuses a mobile money reference received twice and a session of another workstation', async () => {
    const a = workstation();
    const b = workstation();
    const { entityId: sessionA } = await a.dispatch('cash_session.open', {
      openedAt: new Date().toISOString(),
      openingFloat: { USD: 0 },
    });
    const { patientId, invoiceId } = await billedPatient(a, 1000);
    await a.sync();
    const mobile = {
      patientId,
      invoiceId,
      cashSessionId: sessionA,
      method: 'mobile_money' as const,
      currency: 'USD',
      amount: 500,
      invoiceCurrency: 'USD',
      amountInInvoiceCurrency: 500,
      exchangeRate: null,
      exchangeRateDate: null,
      reference: `TX-${String(Date.now())}`,
      operator: 'mpesa' as const,
      receivedAt: new Date().toISOString(),
    };
    await a.dispatch('payment.receive', { ...mobile, receiptNumber: receiptNumber() });
    const twice = await a.dispatch('payment.receive', {
      ...mobile,
      receiptNumber: receiptNumber(),
    });
    await a.sync();
    expect(await reasonOf(twice.entityId)).toBe('FACT_DUPLICATE_REFERENCE');

    const foreign = await b.dispatch('payment.receive', {
      ...mobile,
      method: 'cash',
      reference: null,
      operator: null,
      receiptNumber: receiptNumber(),
    });
    await b.sync();
    expect(await reasonOf(foreign.entityId)).toBe('FACT_SESSION_NOT_YOURS');

    // A variance the workstation did not report is flagged on the server.
    await a.dispatch(
      'cash_session.close',
      {
        status: 'closed',
        closedAt: new Date().toISOString(),
        expected: { USD: 999 },
        counted: { USD: 999 },
      },
      { entityId: sessionA },
    );
    await a.sync();
    const events = await withSystem(handle.db, (tx) =>
      tx
        .select()
        .from(schema.securityEvent)
        .where(
          and(
            eq(schema.securityEvent.kind, 'cash_reconciliation_mismatch'),
            eq(schema.securityEvent.targetTenantId, tenantId),
          ),
        ),
    );
    expect(events.map((e) => (e.detail as { cashSessionId?: string }).cashSessionId)).toContain(
      sessionA,
    );
  });
});
