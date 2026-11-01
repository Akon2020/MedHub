import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { ManualClock, isAppError, toIso, uuidv7 } from '@medhub/shared';
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
const PERMISSIONS = new Set(['patient:create', 'patient:update', 'patient:read', 'patient:merge']);
const START = Date.UTC(2026, 9, 31, 8, 0, 0);

let handle: DbHandle;
type History = typeof import('@/server/modules/pat/history');
let history: History;

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
  const local = new MemoryClientStore();
  const client = new SyncClient({
    store: local,
    transport,
    clock,
    identity: { tenantId, siteId: null, userId, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions: PERMISSIONS,
  });
  return { deviceId, local, client, clock };
}

async function serverPatient(id: string) {
  const [row] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
    tx.select().from(schema.patient).where(eq(schema.patient.id, id)),
  );
  if (!row) throw new Error(id);
  return row;
}

const ctx = () => ({ tenantId, userId, sessionId: uuidv7(), deviceId: null, mfaVerifiedAt: null });

describe.skipIf(!url)('scenario P2: two devices change the same patient offline', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 11).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    history = await import('@/server/modules/pat/history');
    handle = createDb(url as string, 6);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-PDE-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test P2',
        displayName: 'Structure de test P2',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const roleId = uuidv7();
      await tx
        .insert(schema.role)
        .values({ id: roleId, tenantId, code: 'reception', name: 'Accueil' });
      await tx
        .insert(schema.rolePermission)
        .values([...PERMISSIONS].map((permissionKey) => ({ tenantId, roleId, permissionKey })));
      await tx.insert(schema.userAccount).values({
        id: userId,
        tenantId,
        username: 'accueil',
        displayName: 'Accueil fictif',
        passwordHash: 'x',
      });
      await tx.insert(schema.userRole).values({ id: uuidv7(), tenantId, userId, roleId });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  let patientId = '';
  const a = () => devices.a;
  const b = () => devices.b;
  const devices = {} as Record<'a' | 'b', ReturnType<typeof device>>;

  it('keeps the phone of A and the address of B, with no conflict and a field history', async () => {
    devices.a = device(new ManualClock(START));
    devices.b = device(new ManualClock(START + 60_000));
    ({ entityId: patientId } = await a().client.dispatch('patient.register', {
      mrn: 'TST-P2-1',
      familyName: 'Kabila',
      givenName: 'Jean',
      sex: 'M',
      birthDate: '1990-03-12',
      birthDateEstimated: false,
      sensitivity: 'normal',
    }));
    await a().client.sync();
    await b().client.sync();

    // Both offline: A corrects the phone, B the address.
    a().clock.advance(1_000);
    await a().client.dispatch('patient.update', { phone: '0991234567' }, { entityId: patientId });
    b().clock.advance(1_000);
    await b().client.dispatch(
      'patient.update',
      { address: { province: 'Kinshasa', commune: 'Gombe', quarter: 'Golf', street: 'Avenue 12' } },
      { entityId: patientId },
    );

    // Reconnection in either order, then a second round so each sees the other.
    await b().client.sync();
    await a().client.sync();
    await b().client.sync();

    const row = await serverPatient(patientId);
    expect(row.phone).toBe('0991234567');
    expect(row.address).toMatchObject({ province: 'Kinshasa', commune: 'Gombe' });
    for (const d of [a(), b()]) {
      const local = d.local.entitiesOf('patient').find((p) => p.id === patientId);
      expect(local?.data).toMatchObject({ phone: '0991234567', address: { commune: 'Gombe' } });
    }
    const conflicts = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.syncConflict),
    );
    expect(conflicts).toEqual([]);

    const { changes } = await history.patientHistory(ctx(), patientId);
    expect(changes.map((c) => [c.field, c.source]).sort()).toEqual([
      ['address', 'sync'],
      ['phone', 'sync'],
    ]);
    const access = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.dataAccessLog),
    );
    expect(access).toMatchObject([{ patientId, screen: 'patient_history' }]);
  });

  it('opens a conflict when both change the birth date, reviewed by the administrator', async () => {
    a().clock.advance(1_000);
    await a().client.dispatch(
      'patient.update',
      { birthDate: '1990-03-13' },
      { entityId: patientId },
    );
    b().clock.advance(1_000);
    await b().client.dispatch(
      'patient.update',
      { birthDate: '1990-03-14' },
      { entityId: patientId },
    );
    await a().client.sync();
    await b().client.sync();

    // docs/02-offline-sync.md: the server keeps its value, the stale write goes to review.
    expect((await serverPatient(patientId)).birthDate).toBe('1990-03-13');
    const { conflicts } = await history.listPatientConflicts(ctx());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      patientId,
      serverValue: { birthDate: '1990-03-13' },
      clientValue: { birthDate: '1990-03-14' },
    });

    await history.resolvePatientConflict(
      ctx(),
      { conflictId: conflicts[0]?.id ?? '', choice: 'apply', reason: 'Acte de naissance vérifié' },
      { ip: null },
    );
    expect((await serverPatient(patientId)).birthDate).toBe('1990-03-14');
    expect((await history.listPatientConflicts(ctx())).conflicts).toEqual([]);
    try {
      await history.resolvePatientConflict(
        ctx(),
        { conflictId: conflicts[0]?.id ?? '', choice: 'keep', reason: 'Encore' },
        { ip: null },
      );
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect(isAppError(error) ? error.code : error).toBe('NOT_FOUND');
    }
    const { changes } = await history.patientHistory(ctx(), patientId);
    expect(changes.filter((c) => c.field === 'birthDate').map((c) => c.source)).toEqual([
      'review',
      'sync',
    ]);
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      expect((await verifyAuditChain(tx, tenantId)).ok).toBe(true);
    });
  });
});
