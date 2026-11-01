import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
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
  'clinical_record:create',
  'clinical_record:read',
  'vital_sign:create',
  'configuration:read',
  'configuration:edit',
];

let handle: DbHandle;
type Programs = typeof import('@/server/modules/dpi/programs');
let programs: Programs;

const ctx = () => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
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

describe.skipIf(!url)('chronic programmes against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    programs = await import('@/server/modules/dpi/programs');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-PRG-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test programmes',
        displayName: 'Structure de test programmes',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const roleId = uuidv7();
      await tx.insert(schema.role).values({ id: roleId, tenantId, code: 'med', name: 'Médecin' });
      await tx
        .insert(schema.rolePermission)
        .values(PERMISSIONS.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
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

  it('lists enrolled patients, those not seen for too long first', async () => {
    const { id: programId } = await programs.saveProgram(
      ctx(),
      {
        code: 'HTA',
        name: 'Hypertension',
        followUpIntervalDays: 30,
        graceDays: 14,
        isActive: true,
      },
      { ip: null },
    );
    const d = workstation();
    const register = async (mrn: string, familyName: string) =>
      (await d.dispatch('patient.register', { mrn, familyName, sex: 'F' })).entityId;
    const seen = await register('TST-PRG-1', 'Vue');
    const lost = await register('TST-PRG-2', 'Perdue');
    const day = 86_400_000;
    await d.dispatch('program_enrollment.enroll', {
      patientId: seen,
      programId,
      enrolledAt: new Date(Date.now() - 90 * day).toISOString(),
    });
    await d.dispatch('program_enrollment.enroll', {
      patientId: lost,
      programId,
      enrolledAt: new Date(Date.now() - 90 * day).toISOString(),
    });
    await d.dispatch('vital_sign.record', {
      patientId: seen,
      code: 'sbp',
      value: 135,
      unit: 'mmHg',
      measuredAt: new Date(Date.now() - 10 * day).toISOString(),
    });
    await d.sync();

    const { rows } = await programs.followUpList(ctx());
    expect(rows.map((r) => [r.mrn, r.lost])).toEqual([
      ['TST-PRG-2', true],
      ['TST-PRG-1', false],
    ]);
    // Enrolled 90 days ago, never seen since: expected 60 days ago.
    expect(rows[0]).toMatchObject({ program: 'Hypertension', daysLate: 60 });
  });
});
