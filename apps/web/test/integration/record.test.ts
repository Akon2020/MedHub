import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPull, processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgSyncStore } from '@/server/modules/sync';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const userId = uuidv7();
const PERMISSIONS = new Set([
  'patient:create',
  'patient:read',
  'clinical_record:create',
  'clinical_record:read',
  'vital_sign:create',
]);

let handle: DbHandle;

function workstation() {
  const deviceId = uuidv7();
  const store = pgSyncStore(handle.db, { tenantId, userId, deviceId });
  const ctx = {
    tenantId,
    userId,
    deviceId,
    permissions: PERMISSIONS,
    devicePublicKey: null,
    serverTime: () => new Date().toISOString(),
  };
  const transport: SyncTransport = {
    push: async (req) =>
      JSON.parse(JSON.stringify(await processPush(store, ctx, JSON.parse(JSON.stringify(req))))),
    pull: async (cursor, opts) =>
      JSON.parse(
        JSON.stringify(
          await processPull(store, {
            cursor,
            ...opts,
            nowMs: Date.now(),
            serverTime: toIso(Date.now()),
          }),
        ),
      ),
  };
  const local = new MemoryClientStore();
  const client = new SyncClient({
    store: local,
    transport,
    clock: new ManualClock(Date.UTC(2026, 10, 2, 8)),
    identity: { tenantId, siteId: null, userId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions: PERMISSIONS,
  });
  return { client, local };
}

const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

describe.skipIf(!url)('allergies, history, problems and access journal against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-DPI-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test dossier',
        displayName: 'Structure de test dossier',
        type: 'clinic',
        status: 'active',
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('keeps additions of two offline devices, retracts with a reason, indexes the timeline', async () => {
    const a = workstation();
    const b = workstation();
    const { entityId: patientId } = await a.client.dispatch('patient.register', {
      mrn: 'TST-DPI-1',
      familyName: 'Mbala',
      sex: 'F',
    });
    await a.client.sync();
    await b.client.sync();

    const first = await a.client.dispatch('allergy.add', {
      patientId,
      substance: 'Amoxicilline',
      category: 'drug',
      severity: 'severe',
      notedAt: '2026-11-02T08:00:00.000Z',
    });
    await b.client.dispatch('medical_history.add', {
      patientId,
      category: 'surgical',
      label: 'Césarienne',
      startDate: '2019-04-01',
      notedAt: '2026-11-02T08:05:00.000Z',
    });
    await b.client.dispatch('problem.add', {
      patientId,
      label: 'Hypertension artérielle',
      icd10: 'I10',
      notedAt: '2026-11-02T08:06:00.000Z',
    });
    await b.client.sync();
    await a.client.sync();
    await b.client.sync();

    for (const d of [a, b]) {
      expect(d.local.entitiesOf('allergy')).toHaveLength(1);
      expect(d.local.entitiesOf('medical_history')).toHaveLength(1);
      expect(d.local.entitiesOf('problem')).toHaveLength(1);
    }

    await b.client.dispatch(
      'allergy.retract',
      { retractReason: 'Erreur de saisie', retractedAt: '2026-11-02T09:00:00.000Z' },
      { entityId: first.entityId },
    );
    await b.client.sync();
    const [row] = await tenantTx((tx) =>
      tx.select().from(schema.allergy).where(eq(schema.allergy.id, first.entityId)),
    );
    expect(row).toMatchObject({ status: 'retracted', retractReason: 'Erreur de saisie' });

    const events = await tenantTx((tx) =>
      tx
        .select({ kind: schema.clinicalEvent.kind })
        .from(schema.clinicalEvent)
        .where(eq(schema.clinicalEvent.patientId, patientId)),
    );
    expect(events.map((e) => e.kind).sort()).toEqual(['allergy', 'history', 'problem']);
  });

  it('logs the opening of a record made offline, in the journal and the audit chain', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.client.dispatch('patient.register', {
      mrn: 'TST-DPI-2',
      familyName: 'Ngoy',
      sex: 'M',
    });
    await d.client.dispatch('record_access.log', {
      patientId,
      screen: 'patient_record',
      at: '2026-11-02T10:00:00.000Z',
    });
    await d.client.sync();
    const access = await tenantTx((tx) =>
      tx.select().from(schema.dataAccessLog).where(eq(schema.dataAccessLog.patientId, patientId)),
    );
    expect(access).toMatchObject([{ userId, screen: 'patient_record' }]);
    const reads = await tenantTx((tx) =>
      tx
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.patientId, patientId)),
    );
    expect(reads.map((r) => r.action).sort()).toEqual(['create', 'read']);
    expect((await tenantTx((tx) => verifyAuditChain(tx, tenantId))).ok).toBe(true);
    // The journal never travels back to devices.
    expect(d.local.entitiesOf('record_access')).toHaveLength(1);
  });
});
