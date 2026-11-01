import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const adminId = uuidv7();
const clerkId = uuidv7();
const siteId = uuidv7();
const departmentId = uuidv7();
const client = { ip: '203.0.113.70' };

let handle: DbHandle;
type Rdv = typeof import('@/server/modules/rdv/config');
type Reference = typeof import('@/server/modules/core/reference');
let rdv: Rdv;
let reference: Reference;

const ctxFor = (userId: string, mfaVerifiedAt: Date | null = new Date()) => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt,
});

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) ? error.code : error).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

describe.skipIf(!url)('RDV configuration against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 16).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    rdv = await import('@/server/modules/rdv/config');
    reference = await import('@/server/modules/core/reference');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-RDV-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test agendas',
        displayName: 'Structure de test agendas',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      await tx.insert(schema.site).values({ id: siteId, tenantId, code: 'KIN', name: 'Kinshasa' });
      await tx.insert(schema.department).values({
        id: departmentId,
        tenantId,
        siteId,
        code: 'CONS',
        name: 'Consultations',
        kind: 'clinical',
      });
      const adminRole = uuidv7();
      const clerkRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'admin', name: 'Administration' },
        { id: clerkRole, tenantId, code: 'reception', name: 'Accueil' },
      ]);
      await tx.insert(schema.rolePermission).values([
        { tenantId, roleId: adminRole, permissionKey: 'configuration:read' },
        { tenantId, roleId: adminRole, permissionKey: 'configuration:edit' },
        { tenantId, roleId: clerkRole, permissionKey: 'configuration:read' },
      ]);
      await tx.insert(schema.userAccount).values([
        { id: adminId, tenantId, username: 'admin', displayName: 'Admin', passwordHash: 'x' },
        {
          id: clerkId,
          tenantId,
          username: 'medecin',
          displayName: 'Kasongo',
          title: 'Dr',
          passwordHash: 'x',
        },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: clerkId, roleId: clerkRole },
      ]);
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  const queue = {
    code: 'CONS',
    name: 'Consultations',
    ticketPrefix: 'C',
    siteId,
    departmentId,
    isActive: true,
  };

  it('saves queues with a recent second factor and the edit permission only', async () => {
    await expectCode(rdv.saveQueue(ctxFor(clerkId), queue, client), 'PERMISSION_DENIED');
    await expectCode(rdv.saveQueue(ctxFor(adminId, null), queue, client), 'AUTH_STEP_UP_REQUIRED');
    const { id } = await rdv.saveQueue(ctxFor(adminId), queue, client);
    await expectCode(rdv.saveQueue(ctxFor(adminId), queue, client), 'RDV_CODE_TAKEN');
    await rdv.saveQueue(ctxFor(adminId), { ...queue, id, name: 'Consultations externes' }, client);
    const view = await rdv.getRdvConfig(ctxFor(clerkId));
    expect(view.queues).toMatchObject([{ id, name: 'Consultations externes', ticketPrefix: 'C' }]);
    expect(view.canEdit).toBe(false);
  });

  it('replaces a weekly agenda and keeps exceptions, all sent to the devices', async () => {
    await rdv.saveAppointmentType(
      ctxFor(adminId),
      { code: 'CONS', name: 'Consultation', durationMin: 20, color: '#0f6b6b', isActive: true },
      client,
    );
    const agenda = { resourceKind: 'practitioner' as const, resourceId: clerkId };
    await rdv.saveSchedule(
      ctxFor(adminId),
      {
        ...agenda,
        slots: [
          { weekday: 1, startTime: '08:00', endTime: '12:00', slotMin: 20, overbookMax: 1 },
          { weekday: 3, startTime: '08:00', endTime: '12:00', slotMin: 20, overbookMax: 0 },
        ],
      },
      client,
    );
    await rdv.saveSchedule(
      ctxFor(adminId),
      {
        ...agenda,
        slots: [{ weekday: 2, startTime: '14:00', endTime: '17:00', slotMin: 20, overbookMax: 0 }],
      },
      client,
    );
    const { id } = await rdv.addScheduleException(
      ctxFor(adminId),
      { ...agenda, date: '2099-12-25', kind: 'closed', reason: 'Fête' },
      client,
    );
    await expectCode(
      rdv.saveSchedule(ctxFor(adminId), { ...agenda, resourceId: uuidv7(), slots: [] }, client),
      'NOT_FOUND',
    );

    const snapshot = await reference.catalogSnapshot(ctxFor(clerkId));
    expect(snapshot.schedules).toEqual([
      {
        resourceKind: 'practitioner',
        resourceId: clerkId,
        weekday: 2,
        startTime: '14:00',
        endTime: '17:00',
        slotMin: 20,
        overbookMax: 0,
      },
    ]);
    expect(snapshot.scheduleExceptions).toMatchObject([{ date: '2099-12-25', kind: 'closed' }]);
    expect(snapshot.queues?.map((q) => q.ticketPrefix)).toEqual(['C']);
    expect(snapshot.appointmentTypes).toMatchObject([{ code: 'CONS', durationMin: 20 }]);
    expect(snapshot.staff?.find((s) => s.id === clerkId)).toMatchObject({ title: 'Dr' });

    await rdv.removeScheduleException(ctxFor(adminId), { id }, client);
    expect((await rdv.getRdvConfig(ctxFor(adminId))).exceptions).toEqual([]);
  });
});
