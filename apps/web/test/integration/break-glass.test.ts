import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, isAppError, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
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
const doctorId = uuidv7();
const otherId = uuidv7();
const managerId = uuidv7();
const DOCTOR = [
  'patient:read',
  'patient:create',
  'clinical_record:read',
  'clinical_record:break_glass',
];

let handle: DbHandle;
type Service = typeof import('@/server/modules/sync/service');
type Glass = typeof import('@/server/modules/dpi/break-glass');
let service: Service;
let glass: Glass;

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

function workstation(userId: string, deviceId: string) {
  const permissions = new Set(DOCTOR);
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

describe.skipIf(!url)('emergency access (scenario P10) against PostgreSQL', () => {
  let doctorDevice = '';
  let otherDevice = '';
  let patientId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 18).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    service = await import('@/server/modules/sync/service');
    glass = await import('@/server/modules/dpi/break-glass');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-BRG-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test urgence',
        displayName: 'Structure de test urgence',
        type: 'hospital',
        status: 'suspended',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const doctorRole = uuidv7();
      const managerRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: doctorRole, tenantId, code: 'physician', name: 'Médecin' },
        { id: managerRole, tenantId, code: 'director', name: 'Direction' },
      ]);
      await tx
        .insert(schema.rolePermission)
        .values([
          ...DOCTOR.map((permissionKey) => ({ tenantId, roleId: doctorRole, permissionKey })),
          { tenantId, roleId: managerRole, permissionKey: 'audit:review' },
        ]);
      await tx.insert(schema.userAccount).values([
        { id: doctorId, tenantId, username: 'med', displayName: 'Dr Kasongo', passwordHash: 'x' },
        { id: otherId, tenantId, username: 'med2', displayName: 'Dr Ilunga', passwordHash: 'x' },
        { id: managerId, tenantId, username: 'dir', displayName: 'Direction', passwordHash: 'x' },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: doctorId, roleId: doctorRole },
        { id: uuidv7(), tenantId, userId: otherId, roleId: doctorRole },
        { id: uuidv7(), tenantId, userId: managerId, roleId: managerRole },
      ]);
      patientId = uuidv7();
      await tx.insert(schema.patient).values({
        id: patientId,
        tenantId,
        mrn: 'TST-BRG-1',
        familyName: 'Protégé',
        sex: 'M',
        sensitivity: 'restricted',
        searchText: 'protege',
        phoneticKey: 'PRTJ',
      });
    });
    doctorDevice = await addDevice(doctorId, 'DR');
    otherDevice = await addDevice(otherId, 'OT');
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('records an emergency access opened offline, even for a suspended structure', async () => {
    const doctor = workstation(doctorId, doctorDevice);
    const now = Date.now();
    await doctor.dispatch('break_glass.start', {
      patientId,
      reasonCode: 'unconscious_patient',
      reasonText: 'Arrivé inconscient aux urgences',
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + 4 * 3_600_000).toISOString(),
    });
    await doctor.sync();

    const [event] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select()
        .from(schema.breakGlassEvent)
        .where(eq(schema.breakGlassEvent.patientId, patientId)),
    );
    expect(event).toMatchObject({ userId: doctorId, reasonCode: 'unconscious_patient' });
    const kinds = await withSystem(handle.db, (tx) =>
      tx
        .select({ kind: schema.securityEvent.kind })
        .from(schema.securityEvent)
        .where(eq(schema.securityEvent.targetTenantId, tenantId)),
    );
    expect(kinds.map((k) => k.kind)).toContain('break_glass');
    const audit = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.patientId, patientId)),
    );
    expect(audit.map((a) => a.action)).toContain('break_glass');

    // Only its author gets the access back on pull.
    const mine = await service.pull(ctxFor(doctorId, doctorDevice), {
      deviceId: doctorDevice,
      cursor: 0,
      limit: 200,
      lookback: false,
    });
    expect(mine.changes.some((c) => c.entity === 'break_glass')).toBe(true);
    const theirs = await service.pull(ctxFor(otherId, otherDevice), {
      deviceId: otherDevice,
      cursor: 0,
      limit: 200,
      lookback: false,
    });
    expect(theirs.changes.some((c) => c.entity === 'break_glass')).toBe(false);
  });

  it('puts every access on the review board, reviewed once', async () => {
    try {
      await glass.listBreakGlass(ctxFor(doctorId));
      throw new Error('expected PERMISSION_DENIED');
    } catch (error) {
      expect(isAppError(error) ? error.code : error).toBe('PERMISSION_DENIED');
    }
    const { events } = await glass.listBreakGlass(ctxFor(managerId));
    expect(events).toMatchObject([
      { user: 'Dr Kasongo', patientMrn: 'TST-BRG-1', reviewedAt: null },
    ]);
    const id = events[0]?.id ?? '';
    await glass.reviewBreakGlass(
      ctxFor(managerId),
      { breakGlassId: id, outcome: 'justified', comment: 'Urgence confirmée' },
      { ip: null },
    );
    try {
      await glass.reviewBreakGlass(
        ctxFor(managerId),
        { breakGlassId: id, outcome: 'justified' },
        {
          ip: null,
        },
      );
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect(isAppError(error) ? error.code : error).toBe('NOT_FOUND');
    }
    const after = await glass.listBreakGlass(ctxFor(managerId));
    expect(after.events[0]).toMatchObject({ reviewOutcome: 'justified' });
  });
});
