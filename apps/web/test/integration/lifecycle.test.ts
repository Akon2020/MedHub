import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPull, processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
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
  'patient:update',
  'patient:read',
  'patient:mark_deceased',
  'vital_sign:create',
]);

let handle: DbHandle;

function device(clock: ManualClock) {
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
  const client = new SyncClient({
    store: new MemoryClientStore(),
    transport,
    clock,
    identity: { tenantId, siteId: null, userId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions: PERMISSIONS,
  });
  return { client, clock };
}

async function serverPatient(id: string) {
  const [row] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
    tx.select().from(schema.patient).where(eq(schema.patient.id, id)),
  );
  if (!row) throw new Error(id);
  return row;
}

async function historyOf(id: string) {
  return withTenant(handle.db, { tenantId, userId: null }, (tx) =>
    tx
      .select({ field: schema.patientFieldHistory.field })
      .from(schema.patientFieldHistory)
      .where(eq(schema.patientFieldHistory.patientId, id)),
  );
}

describe.skipIf(!url)('provisional records and death against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 13).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-LIF-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test cycle de vie',
        displayName: 'Structure de test cycle de vie',
        type: 'clinic',
        status: 'active',
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('identifies an unknown patient later, then looks for duplicates', async () => {
    const a = device(new ManualClock(Date.UTC(2026, 10, 1, 22, 15)));
    const { entityId } = await a.client.dispatch('patient.register', {
      mrn: 'TST-LIF-1',
      familyName: 'Inconnu homme 30 ans environ, arrivé le 01/11 22:15',
      sex: 'M',
      birthDate: '1996-01-01',
      birthDateEstimated: true,
      isProvisional: true,
      provisionalKind: 'unknown',
    });
    await a.client.sync();
    expect(await serverPatient(entityId)).toMatchObject({
      isProvisional: true,
      provisionalKind: 'unknown',
    });

    a.clock.advance(3_600_000);
    await a.client.dispatch(
      'patient.update',
      { familyName: 'Mukendi', givenName: 'Paul', isProvisional: false },
      { entityId },
    );
    await a.client.sync();
    expect(await serverPatient(entityId)).toMatchObject({
      familyName: 'Mukendi',
      isProvisional: false,
      provisionalKind: 'unknown',
    });
    expect((await historyOf(entityId)).map((h) => h.field).sort()).toEqual([
      'familyName',
      'givenName',
      'isProvisional',
    ]);
    const jobs = await withSystem(handle.db, (tx) =>
      tx
        .select({ payload: schema.job.payload })
        .from(schema.job)
        .where(
          and(eq(schema.job.tenantId, tenantId), eq(schema.job.type, 'pat.detect_duplicates')),
        ),
    );
    // One at registration, one when the record is identified.
    expect(jobs.filter((j) => j.payload.patientId === entityId)).toHaveLength(2);
  });

  it('records a death, refuses later acts, and withdraws it with a reason', async () => {
    const a = device(new ManualClock(Date.UTC(2026, 10, 1, 8)));
    const { entityId: patientId } = await a.client.dispatch('patient.register', {
      mrn: 'TST-LIF-2',
      familyName: 'Lukusa',
      givenName: 'Ruth',
      sex: 'F',
      birthDate: '1950-02-02',
    });
    await a.client.dispatch(
      'patient.mark_deceased',
      { deceasedAt: '2026-11-01T07:30:00.000Z' },
      { entityId: patientId },
    );
    await a.client.sync();
    expect((await serverPatient(patientId)).deceasedAt?.toISOString()).toBe(
      '2026-11-01T07:30:00.000Z',
    );

    // A second device that has not pulled the death yet.
    const b = device(new ManualClock(Date.UTC(2026, 10, 1, 9)));
    await b.client.sync();
    await expect(
      b.client.dispatch('vital_sign.record', {
        patientId,
        code: 'pulse',
        value: 80,
        unit: '/min',
        measuredAt: '2026-11-01T08:45:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PAT_DECEASED' });

    await a.client.dispatch(
      'patient.mark_deceased',
      { deceasedAt: null, correctionReason: 'Déclaré sur le mauvais dossier' },
      { entityId: patientId },
    );
    await a.client.sync();
    expect((await serverPatient(patientId)).deceasedAt).toBeNull();
    expect((await historyOf(patientId)).map((h) => h.field)).toEqual(['deceasedAt', 'deceasedAt']);
  });
});
