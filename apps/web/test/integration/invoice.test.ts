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
const userId = uuidv7();
const CASHIER = [
  'patient:create',
  'patient:read',
  'invoice:read',
  'invoice:create',
  'invoice:add_line',
  'invoice:finalize',
];

let handle: DbHandle;
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

function workstation(extra: string[] = []) {
  const deviceId = uuidv7();
  const permissions = new Set([...CASHIER, ...extra]);
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

const line = (invoiceId: string, patientId: string, over: Record<string, unknown> = {}) => ({
  invoiceId,
  patientId,
  label: 'Consultation générale',
  category: 'consultation' as const,
  quantity: 1,
  unitPrice: 1000,
  currency: 'USD',
  performedAt: new Date().toISOString(),
  ...over,
});

describe.skipIf(!url)('invoices against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-INV-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test factures',
        displayName: 'Structure de test factures',
        type: 'clinic',
        status: 'active',
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('bills offline, finalizes, and moves a late act to a supplementary invoice', async () => {
    const a = workstation();
    const b = workstation();
    const { entityId: patientId } = await a.dispatch('patient.register', {
      mrn: 'TST-INV-1',
      familyName: 'Kalala',
      sex: 'M',
    });
    const number = `FAC-KIN-AA-2026-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const invoice = await a.dispatch('invoice.open', {
      patientId,
      currency: 'USD',
      number,
      openedAt: new Date().toISOString(),
    });
    await a.dispatch('invoice.add_line', line(invoice.entityId, patientId), {
      dependsOn: [invoice.opId],
    });
    await a.sync();

    // B knew the invoice open; A finalizes it before B's line arrives.
    await b.dispatch(
      'invoice.add_line',
      line(invoice.entityId, patientId, {
        label: 'Goutte épaisse',
        category: 'lab',
        unitPrice: 350,
      }),
    );
    await a.dispatch(
      'invoice.finalize',
      { status: 'finalized', finalizedAt: new Date().toISOString() },
      { entityId: invoice.entityId },
    );
    await a.sync();
    await b.sync();

    const invoices = await tenantTx((tx) =>
      tx.select().from(schema.invoice).where(eq(schema.invoice.patientId, patientId)),
    );
    expect(invoices).toHaveLength(2);
    const original = invoices.find((i) => i.id === invoice.entityId)!;
    const supplementary = invoices.find((i) => i.id !== invoice.entityId)!;
    expect(original.status).toBe('finalized');
    expect(supplementary).toMatchObject({
      status: 'open',
      supplementaryOf: original.id,
      number: `${number}-C1`,
    });
    const lines = await tenantTx((tx) =>
      tx.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.patientId, patientId)),
    );
    expect(lines.find((l) => l.label === 'Goutte épaisse')?.invoiceId).toBe(supplementary.id);
    expect(lines.find((l) => l.label === 'Consultation générale')?.invoiceId).toBe(original.id);

    // The supplementary invoice reaches the devices through the change log.
    const changes = await tenantTx((tx) =>
      tx.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, supplementary.id)),
    );
    expect(changes).toHaveLength(1);

    // A finalized invoice never changes, even by a direct statement.
    await expect(
      tenantTx((tx) =>
        tx.update(schema.invoice).set({ status: 'open' }).where(eq(schema.invoice.id, original.id)),
      ),
    ).rejects.toThrow();
    await expect(
      tenantTx((tx) =>
        tx
          .update(schema.invoiceLine)
          .set({ unitPrice: 1 })
          .where(eq(schema.invoiceLine.invoiceId, original.id)),
      ),
    ).rejects.toThrow();
  });

  it('keeps an act without price, priced later only with the right to set prices', async () => {
    const cashier = workstation();
    const manager = workstation(['price:manage']);
    const { entityId: patientId } = await cashier.dispatch('patient.register', {
      mrn: 'TST-INV-2',
      familyName: 'Ngoy',
      sex: 'F',
    });
    const invoice = await cashier.dispatch('invoice.open', {
      patientId,
      currency: 'USD',
      number: `FAC-KIN-AB-2026-${String(Math.floor(Math.random() * 90000) + 10000)}`,
      openedAt: new Date().toISOString(),
    });
    const { entityId: unpriced } = await cashier.dispatch(
      'invoice.add_line',
      line(invoice.entityId, patientId, { unitPrice: null }),
      { dependsOn: [invoice.opId] },
    );
    const { entityId: wrongCurrency } = await cashier.dispatch(
      'invoice.add_line',
      line(invoice.entityId, patientId, { currency: 'CDF', unitPrice: 2_000_000 }),
    );
    const { entityId: denied } = await cashier.dispatch(
      'invoice.add_line',
      line(invoice.entityId, patientId, {
        supersedesId: unpriced,
        manualPrice: true,
        unitPrice: 800,
      }),
    );
    await cashier.sync();
    expect(await reasonOf(wrongCurrency)).toBe('FACT_CURRENCY_MISMATCH');
    expect(await reasonOf(denied)).toBe('FACT_MANUAL_PRICE_DENIED');

    const { entityId: priced } = await manager.dispatch(
      'invoice.add_line',
      line(invoice.entityId, patientId, {
        supersedesId: unpriced,
        manualPrice: true,
        unitPrice: 800,
      }),
    );
    await manager.sync();
    const rows = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.invoiceLine)
        .where(eq(schema.invoiceLine.invoiceId, invoice.entityId)),
    );
    expect(rows.find((r) => r.id === unpriced)?.status).toBe('superseded');
    expect(rows.find((r) => r.id === priced)).toMatchObject({
      status: 'active',
      unitPrice: 800,
      manualPrice: true,
    });

    // A priced line cannot be replaced: corrections of a price go through a credit note.
    const { entityId: again } = await manager.dispatch(
      'invoice.add_line',
      line(invoice.entityId, patientId, { supersedesId: priced, manualPrice: true, unitPrice: 1 }),
    );
    await manager.sync();
    expect(await reasonOf(again)).toBe('FACT_LINE_NOT_REPLACEABLE');
  });
});
