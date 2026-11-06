import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { newVerificationCode } from '@medhub/domain';
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
const BASE = [
  'patient:create',
  'patient:read',
  'clinical_record:read',
  'clinical_record:create',
  'prescription:read',
  'prescription:create',
  'prescription:cancel',
  'configuration:read',
  'configuration:edit',
];

let handle: DbHandle;
type Service = typeof import('@/server/modules/dpi/prescription');
let service: Service;

const ctx = () => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

function workstation(extra: string[] = []) {
  const deviceId = uuidv7();
  const permissions = new Set([...BASE, ...extra]);
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
  tenantTx((tx) =>
    tx
      .select({ reason: sql<string>`${schema.opLog.result}->>'reason'` })
      .from(schema.opLog)
      .where(eq(schema.opLog.entityId, entityId)),
  );

const verification = () => newVerificationCode((n) => crypto.getRandomValues(new Uint8Array(n)));

describe.skipIf(!url)('prescription against PostgreSQL', () => {
  let amoxicillinId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    service = await import('@/server/modules/dpi/prescription');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-RXP-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test prescription',
        displayName: 'Structure de test prescription',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tenantTx(async (tx) => {
      const roleId = uuidv7();
      await tx.insert(schema.role).values({ id: roleId, tenantId, code: 'med', name: 'Médecin' });
      await tx
        .insert(schema.rolePermission)
        .values(BASE.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
      await tx.insert(schema.userAccount).values({
        id: userId,
        tenantId,
        username: 'med',
        displayName: 'Médecin',
        passwordHash: 'x',
      });
      await tx.insert(schema.userRole).values({ id: uuidv7(), tenantId, userId, roleId });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('imports the catalogue and the interaction rules after a check', async () => {
    const csv = [
      'code;dci;atc;forme;dosage;unite_dose;dose_max_kg_jour',
      'AMOX500;Amoxicilline;J01CA04;gélule;500 mg;mg;100',
      'AZI250;Azithromycine;J01FA10;comprimé;250 mg;mg;',
    ].join('\n');
    expect(await service.importDrugs(ctx(), { csv, apply: false }, { ip: null })).toMatchObject({
      items: 2,
      errors: [],
      total: 0,
    });
    const out = await service.importDrugs(ctx(), { csv, apply: true }, { ip: null });
    expect(out.total).toBe(2);
    const rules = await service.importInteractions(
      ctx(),
      { csv: 'atc_a;atc_b;gravite;message\nB01AA;N02BA;majeure;Risque hémorragique', apply: true },
      { ip: null },
    );
    expect(rules.total).toBe(1);
    const drugs = await tenantTx((tx) => service.activeDrugs(tx));
    amoxicillinId = drugs.find((d) => d.code === 'AMOX500')?.id ?? '';
    expect(drugs.find((d) => d.code === 'AMOX500')).toMatchObject({
      atcCode: 'J01CA04',
      maxDailyDosePerKg: 100,
    });
  });

  it('stores the lines, refuses an override without the permission, reports an unseen allergy', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-RX-1',
      familyName: 'Tshibola',
      sex: 'F',
    });
    const line = {
      drugId: amoxicillinId,
      drugCode: 'AMOX500',
      label: 'Amoxicilline 500 mg gélule',
      atcCode: 'J01CA04',
      doseValue: 500,
      doseUnit: 'mg',
      frequency: '3x/d' as const,
      durationDays: 7,
      quantity: 10500,
    };
    const { entityId: rxId } = await d.dispatch('prescription.create', {
      patientId,
      prescribedAt: new Date().toISOString(),
      verificationCode: verification(),
      items: [line],
    });
    const { entityId: overrideId } = await d.dispatch('prescription.create', {
      patientId,
      prescribedAt: new Date().toISOString(),
      verificationCode: verification(),
      items: [
        {
          ...line,
          alertsAcknowledged: [
            { code: 'ALLERGY', severity: 'blocking', justification: 'Test cutané négatif récent' },
          ],
        },
      ],
    });
    await d.sync();

    const items = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.prescriptionItem)
        .where(eq(schema.prescriptionItem.prescriptionId, rxId)),
    );
    expect(items).toMatchObject([
      { label: 'Amoxicilline 500 mg gélule', frequency: '3x/d', quantity: 10500, position: 0 },
    ]);
    expect((await reasonOf(overrideId))[0]?.reason).toBe('PRESC_OVERRIDE_DENIED');

    // Another workstation recorded the allergy meanwhile: the server reports the
    // prescription that could not see it, and keeps it.
    await d.dispatch('allergy.add', {
      patientId,
      substance: 'Amoxicilline',
      atcCode: 'J01CA04',
      category: 'drug',
      severity: 'severe',
      notedAt: new Date().toISOString(),
    });
    await d.sync();
    const { entityId: lateId } = await d.dispatch('prescription.create', {
      patientId,
      prescribedAt: new Date().toISOString(),
      verificationCode: verification(),
      items: [line],
    });
    await d.sync();
    const [kept] = await tenantTx((tx) =>
      tx.select().from(schema.prescription).where(eq(schema.prescription.id, lateId)),
    );
    expect(kept?.status).toBe('active');
    const events = await withSystem(handle.db, (tx) =>
      tx
        .select()
        .from(schema.securityEvent)
        .where(
          and(
            eq(schema.securityEvent.kind, 'prescription_alert_unseen'),
            eq(schema.securityEvent.targetTenantId, tenantId),
          ),
        ),
    );
    expect(events.map((e) => (e.detail as { prescriptionId?: string }).prescriptionId)).toEqual([
      lateId,
    ]);

    const overriding = workstation(['prescription:override_alert']);
    const { entityId: allowedId } = await overriding.dispatch('prescription.create', {
      patientId,
      prescribedAt: new Date().toISOString(),
      verificationCode: verification(),
      items: [
        {
          ...line,
          alertsAcknowledged: [
            { code: 'ALLERGY', severity: 'blocking', justification: 'Test cutané négatif récent' },
          ],
        },
      ],
    });
    await overriding.sync();
    const [allowed] = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.prescriptionItem)
        .where(eq(schema.prescriptionItem.prescriptionId, allowedId)),
    );
    expect(allowed?.alertsAcknowledged).toEqual([
      { code: 'ALLERGY', severity: 'blocking', justification: 'Test cutané négatif récent' },
    ]);

    await d.dispatch(
      'prescription.cancel',
      { status: 'cancelled', cancelReason: 'Erreur de patient' },
      { entityId: rxId },
    );
    await d.sync();
    const [cancelled] = await tenantTx((tx) =>
      tx.select().from(schema.prescription).where(eq(schema.prescription.id, rxId)),
    );
    expect(cancelled?.status).toBe('cancelled');
    await expect(
      tenantTx((tx) =>
        tx
          .update(schema.prescriptionItem)
          .set({ doseValue: 1000 })
          .where(eq(schema.prescriptionItem.prescriptionId, rxId)),
      ),
    ).rejects.toThrow();
  });

  it('confirms a printed code publicly without showing any health data', async () => {
    const { verifyPrescription } = await import('@/server/platform/verification');
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-RX-3',
      familyName: 'Kabeya',
      sex: 'M',
    });
    const code = verification();
    const { entityId } = await d.dispatch('prescription.create', {
      patientId,
      prescribedAt: '2026-11-06T09:00:00.000Z',
      verificationCode: code,
      items: [{ label: 'Paracétamol 500 mg', doseValue: 1, doseUnit: 'cp', frequency: '3x/d' }],
    });
    await d.sync();
    const ip = `198.51.100.${String(Math.floor(Math.random() * 200) + 1)}`;
    expect(await verifyPrescription(code.toLowerCase(), ip)).toEqual({
      found: true,
      status: 'active',
      issuedOn: '2026-11-06',
      structure: 'Structure de test prescription',
    });
    expect(await verifyPrescription('ABCDEFGHJK', ip)).toEqual({ found: false });
    expect(await verifyPrescription('<script>', ip)).toEqual({ found: false });
    await d.dispatch(
      'prescription.cancel',
      { status: 'cancelled', cancelReason: 'Erreur de saisie' },
      { entityId },
    );
    await d.sync();
    expect(await verifyPrescription(code, ip)).toMatchObject({ found: true, status: 'cancelled' });
  });

  it('keeps habitual treatments and records the reconciliation decisions', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-RX-2',
      familyName: 'Mukendi',
      sex: 'M',
    });
    const { entityId: statementId } = await d.dispatch('medication_statement.add', {
      patientId,
      label: 'Amlodipine 5 mg',
      dose: '1 cp le matin',
      notedAt: new Date().toISOString(),
    });
    await d.dispatch('medication_reconciliation.record', {
      patientId,
      decisions: [{ statementId, label: 'Amlodipine 5 mg', decision: 'stop', note: 'Hypotension' }],
      performedAt: new Date().toISOString(),
    });
    await d.dispatch(
      'medication_statement.stop',
      { status: 'stopped', stoppedOn: new Date().toISOString().slice(0, 10) },
      { entityId: statementId },
    );
    await d.sync();
    const [statement] = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.medicationStatement)
        .where(eq(schema.medicationStatement.id, statementId)),
    );
    expect(statement?.status).toBe('stopped');
    const reconciliations = await tenantTx((tx) =>
      tx
        .select()
        .from(schema.medicationReconciliation)
        .where(eq(schema.medicationReconciliation.patientId, patientId)),
    );
    expect(reconciliations[0]?.decisions).toEqual([
      { statementId, label: 'Amlodipine 5 mg', decision: 'stop', note: 'Hypotension' },
    ]);
  });
});
