import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
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
const PERMISSIONS = ['patient:read', 'patient:create', 'vital_sign:read', 'vital_sign:create'];
const LONG_AGO = new Date(Date.now() - 60 * 86_400_000);

let handle: DbHandle;
type Service = typeof import('@/server/modules/sync/service');
type Search = typeof import('@/server/modules/pat/search');
type Scope = typeof import('@/server/modules/sync/scope');
let service: Service;
let search: Search;
let scope: Scope;

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

/** A workstation writing through the sync engine; reading goes through the real pull. */
function workstation(userId: string, deviceId: string) {
  const permissions = new Set([...PERMISSIONS]);
  const store = pgSyncStore(handle.db, { tenantId, userId, deviceId });
  const ctx = {
    tenantId,
    userId,
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
    clock: new ManualClock(Date.now()),
    identity: { tenantId, siteId: null, userId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions,
  });
}

const register = (client: SyncClient, mrn: string, familyName: string) =>
  client.dispatch('patient.register', { mrn, familyName, sex: 'F' });

describe.skipIf(!url)('synchronisation scope against PostgreSQL', () => {
  let nurseDevice = '';
  const ids = { mine: '', favorite: '', recent: '', old: '' };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 15).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    service = await import('@/server/modules/sync/service');
    search = await import('@/server/modules/pat/search');
    scope = await import('@/server/modules/sync/scope');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-SCO-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test périmètre',
        displayName: 'Structure de test périmètre',
        type: 'hospital',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'direction', name: 'Direction' },
        { id: nurseRole, tenantId, code: 'nurse', name: 'Infirmier' },
      ]);
      await tx.insert(schema.rolePermission).values([
        ...[...PERMISSIONS, 'configuration:read', 'configuration:edit'].map((permissionKey) => ({
          tenantId,
          roleId: adminRole,
          permissionKey,
        })),
        ...PERMISSIONS.map((permissionKey) => ({ tenantId, roleId: nurseRole, permissionKey })),
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
    const admin = workstation(adminId, await addDevice(adminId, 'AD'));
    nurseDevice = await addDevice(nurseId, 'NU');
    const nurse = workstation(nurseId, nurseDevice);

    ids.favorite = (await register(admin, 'TST-SCO-1', 'Favori')).entityId;
    ids.recent = (await register(admin, 'TST-SCO-2', 'Recent')).entityId;
    ids.old = (await register(admin, 'TST-SCO-3', 'Ancien')).entityId;
    await admin.sync();
    // Nothing happened to these three for two months...
    await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .update(schema.patient)
        .set({ updatedAt: LONG_AGO })
        .where(inArray(schema.patient.id, [ids.favorite, ids.recent, ids.old])),
    );
    // ...until a measurement today for one of them.
    await admin.dispatch('vital_sign.record', {
      patientId: ids.recent,
      code: 'temp',
      value: 38.2,
      unit: '°C',
      measuredAt: new Date().toISOString(),
    });
    // The administrator's favourite is personal: it neither reaches nor widens the nurse's scope.
    await admin.dispatch('patient.favorite', {
      patientId: ids.old,
      active: true,
      at: new Date().toISOString(),
    });
    await admin.sync();

    ids.mine = (await register(nurse, 'TST-SCO-4', 'Mienne')).entityId;
    await nurse.dispatch('patient.favorite', {
      patientId: ids.favorite,
      active: true,
      at: new Date().toISOString(),
    });
    await nurse.sync();
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  const pullAll = () =>
    service.pull(ctxFor(nurseId, nurseDevice), {
      deviceId: nurseDevice,
      cursor: 0,
      limit: 200,
      lookback: false,
    });
  const sent = (changes: Awaited<ReturnType<typeof pullAll>>['changes'], entity: string) =>
    changes.filter((c) => c.entity === entity && c.data !== null).map((c) => c.entityId);

  it('sends the whole structure while no rule restricts it', async () => {
    const { changes } = await pullAll();
    expect(sent(changes, 'patient').sort()).toEqual(Object.values(ids).sort());
    expect(sent(changes, 'patient_favorite')).toHaveLength(1);
  });

  it('keeps own, favourite and recently active patients under a scoped rule', async () => {
    await scope.saveScopeRule(
      ctxFor(adminId),
      { roleId: null, rule: { mode: 'scoped', recentDays: 30 } },
      { ip: null },
    );
    const { changes } = await pullAll();
    expect(sent(changes, 'patient').sort()).toEqual([ids.mine, ids.favorite, ids.recent].sort());
    expect(changes).toContainEqual(
      expect.objectContaining({ entity: 'patient', entityId: ids.old, data: null, evict: true }),
    );
    expect(sent(changes, 'vital_sign')).toHaveLength(1);
    expect(changes.filter((c) => c.entity === 'patient_favorite')).toHaveLength(1);
    const held = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select({ patientId: schema.devicePatient.patientId })
        .from(schema.devicePatient)
        .where(eq(schema.devicePatient.deviceId, nurseDevice)),
    );
    expect(held.map((h) => h.patientId).sort()).toEqual(
      [ids.mine, ids.favorite, ids.recent].sort(),
    );
  });

  it('keeps a patient opened from a server search on that device', async () => {
    const fetched = await search.fetchPatient(ctxFor(nurseId, nurseDevice), ids.old);
    expect(fetched.data).toMatchObject({ familyName: 'Ancien' });
    const { changes } = await pullAll();
    expect(sent(changes, 'patient')).toContain(ids.old);
  });

  it('brings a patient with an appointment in the coming week', async () => {
    const soonId = uuidv7();
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const [old] = await tx.select().from(schema.patient).where(eq(schema.patient.id, ids.old));
      if (!old) throw new Error('patient');
      // A copy of an old record with no activity, only an appointment next week.
      await tx.insert(schema.patient).values({
        ...old,
        id: soonId,
        mrn: 'TST-SCO-5',
        deviceId: null,
        cardToken: null,
      });
      await tx.insert(schema.changeLog).values({
        tenantId,
        entity: 'patient',
        entityId: soonId,
        version: 1,
        scopeKeys: [`patient:${soonId}`],
      });
    });
    expect(sent((await pullAll()).changes, 'patient')).not.toContain(soonId);
    await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.insert(schema.appointment).values({
        id: uuidv7(),
        tenantId,
        patientId: soonId,
        resourceKind: 'practitioner',
        resourceId: adminId,
        startsAt: new Date(Date.now() + 5 * 86_400_000),
        endsAt: new Date(Date.now() + 5 * 86_400_000 + 900_000),
        status: 'booked',
      }),
    );
    expect(sent((await pullAll()).changes, 'patient')).toContain(soonId);
  });

  it('lets a role rule widen the scope back to the whole structure', async () => {
    await scope.saveScopeRule(
      ctxFor(adminId),
      { roleId: nurseRole, rule: { mode: 'all', recentDays: 30 } },
      { ip: null },
    );
    const view = await scope.listScopeRules(ctxFor(adminId));
    expect(view.defaultRule).toEqual({ mode: 'scoped', recentDays: 30 });
    expect(view.roles.find((r) => r.roleId === nurseRole)?.rule?.mode).toBe('all');
    const { changes } = await pullAll();
    expect(changes.some((c) => c.evict)).toBe(false);
  });
});
