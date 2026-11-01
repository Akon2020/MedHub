import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, isAppError, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
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
const adminId = uuidv7();
const nurseId = uuidv7();
const nurseRole = uuidv7();
const ADMIN = [
  'patient:read',
  'patient:create',
  'patient:mark_sensitive',
  'vital_sign:read',
  'vital_sign:create',
];
const NURSE = ['patient:read', 'vital_sign:read'];

let handle: DbHandle;
type Service = typeof import('@/server/modules/sync/service');
type Search = typeof import('@/server/modules/pat/search');
let service: Service;
let search: Search;

const ctxFor = (userId: string, deviceId: string | null = null) => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId,
  mfaVerifiedAt: null,
});

async function addDevice(userId: string, code: string): Promise<string> {
  const id = uuidv7();
  await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
    tx.insert(schema.device).values({
      id,
      tenantId,
      userId,
      deviceCode: code,
      name: `Poste ${code}`,
      kind: 'tablet',
      publicKey: 'test',
    }),
  );
  return id;
}

/** The admin's device writes through the sync engine, like a real workstation. */
function adminClient(deviceId: string) {
  const permissions = new Set(ADMIN);
  const store = pgSyncStore(handle.db, { tenantId, userId: adminId, deviceId });
  const ctx = {
    tenantId,
    userId: adminId,
    deviceId,
    permissions,
    devicePublicKey: null,
    serverTime: () => new Date().toISOString(),
  };
  const transport: SyncTransport = {
    push: async (req) =>
      JSON.parse(JSON.stringify(await processPush(store, ctx, JSON.parse(JSON.stringify(req))))),
    pull: async () => ({ changes: [], nextCursor: 0, hasMore: false, serverTime: toIso(0) }),
  };
  return new SyncClient({
    store: new MemoryClientStore(),
    transport,
    clock: new ManualClock(Date.UTC(2026, 10, 1, 9)),
    identity: { tenantId, siteId: null, userId: adminId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions,
  });
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

describe.skipIf(!url)('sensitive records against PostgreSQL', () => {
  let adminDevice = '';
  let nurseDevice = '';
  let patientId = '';
  let cursor = 0;
  let admin: ReturnType<typeof adminClient>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 14).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    service = await import('@/server/modules/sync/service');
    search = await import('@/server/modules/pat/search');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-SEN-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test sensibilité',
        displayName: 'Structure de test sensibilité',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'direction', name: 'Direction' },
        { id: nurseRole, tenantId, code: 'nurse', name: 'Infirmier' },
      ]);
      await tx
        .insert(schema.rolePermission)
        .values([
          ...ADMIN.map((permissionKey) => ({ tenantId, roleId: adminRole, permissionKey })),
          ...NURSE.map((permissionKey) => ({ tenantId, roleId: nurseRole, permissionKey })),
        ]);
      await tx.insert(schema.userAccount).values([
        {
          id: adminId,
          tenantId,
          username: 'direction',
          displayName: 'Direction',
          passwordHash: 'x',
        },
        {
          id: nurseId,
          tenantId,
          username: 'infirmier',
          displayName: 'Infirmier',
          passwordHash: 'x',
        },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: nurseId, roleId: nurseRole },
      ]);
    });
    adminDevice = await addDevice(adminId, 'AD');
    nurseDevice = await addDevice(nurseId, 'NU');
    admin = adminClient(adminDevice);
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  const pullAs = (userId: string, deviceId: string, from: number) =>
    service.pull(ctxFor(userId, deviceId), { deviceId, cursor: from, limit: 200, lookback: false });

  it('sends a normal record and its vital signs to every reader', async () => {
    ({ entityId: patientId } = await admin.dispatch('patient.register', {
      mrn: 'TST-SEN-1',
      familyName: 'Tshisekedi',
      givenName: 'Aimé',
      sex: 'M',
      birthDate: '1970-05-05',
    }));
    await admin.dispatch('vital_sign.record', {
      patientId,
      code: 'temp',
      value: 37,
      unit: '°C',
      measuredAt: '2026-11-01T08:00:00.000Z',
    });
    await admin.sync();
    const page = await pullAs(nurseId, nurseDevice, 0);
    expect(page.changes.map((c) => c.entity).sort()).toEqual(['patient', 'vital_sign']);
    cursor = page.nextCursor;
  });

  it('still sends a sensitive record, to be locked on devices below its level', async () => {
    await admin.dispatch(
      'patient.set_sensitivity',
      { sensitivity: 'vip', sensitivityReason: 'Personnalité publique' },
      { entityId: patientId },
    );
    await admin.sync();

    // Break glass must work offline (P10): the record stays on the device, locked.
    const nurse = await pullAs(nurseId, nurseDevice, cursor);
    expect(nurse.changes).toEqual([
      expect.objectContaining({ entity: 'patient', entityId: patientId }),
    ]);
    expect(nurse.changes[0]?.data).toMatchObject({ sensitivity: 'vip' });
    expect(nurse.changes[0]?.evict).toBeUndefined();

    const own = await pullAs(adminId, adminDevice, cursor);
    // The reason stays in the operation log, never in the record.
    expect(own.changes[0]?.data).not.toHaveProperty('sensitivityReason');
    const history = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select({ field: schema.patientFieldHistory.field })
        .from(schema.patientFieldHistory)
        .where(eq(schema.patientFieldHistory.patientId, patientId)),
    );
    expect(history.map((h) => h.field)).toEqual(['sensitivity']);
  });

  it('masks the record in the server search and opens it only through an emergency access', async () => {
    const hit = async (userId: string) =>
      (await search.searchPatients(ctxFor(userId), { q: 'Tshisekedi', cursor: 0 })).hits[0];
    expect(await hit(nurseId)).toMatchObject({ protected: true, name: '', phone: null });
    expect(await hit(adminId)).toMatchObject({ protected: false, name: 'Tshisekedi Aimé' });
    await expectCode(search.fetchPatient(ctxFor(nurseId), patientId), 'PAT_SENSITIVE');

    // An emergency access that ended no longer opens it; a running one does.
    const grant = (startedAt: number, endsAt: number) =>
      withTenant(handle.db, { tenantId, userId: null }, (tx) =>
        tx.insert(schema.breakGlassEvent).values({
          id: uuidv7(),
          tenantId,
          userId: nurseId,
          patientId,
          reasonCode: 'life_threatening',
          reasonText: 'Patient inconscient aux urgences',
          startedAt: new Date(startedAt),
          endsAt: new Date(endsAt),
        }),
      );
    await grant(Date.now() - 6 * 3_600_000, Date.now() - 2 * 3_600_000);
    await expectCode(search.fetchPatient(ctxFor(nurseId), patientId), 'PAT_SENSITIVE');
    await grant(Date.now() - 60_000, Date.now() + 4 * 3_600_000);
    expect((await search.fetchPatient(ctxFor(nurseId), patientId)).data).toMatchObject({
      sensitivity: 'vip',
    });
  });

  it('opens it again once the role reaches the level', async () => {
    await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .update(schema.rolePermission)
        .set({ conditions: { sensitivity_max: 'vip' } })
        .where(
          and(
            eq(schema.rolePermission.roleId, nurseRole),
            eq(schema.rolePermission.permissionKey, 'patient:read'),
          ),
        ),
    );
    expect((await search.fetchPatient(ctxFor(nurseId), patientId)).data).toMatchObject({
      sensitivity: 'vip',
    });
    const full = await pullAs(nurseId, nurseDevice, 0);
    expect(full.changes.map((c) => c.entity).sort()).toEqual(['patient', 'vital_sign']);
  });
});
