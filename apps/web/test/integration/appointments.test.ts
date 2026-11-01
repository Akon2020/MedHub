import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
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
const doctorId = uuidv7();
const PERMISSIONS = new Set([
  'patient:create',
  'patient:read',
  'appointment:create',
  'appointment:read',
  'appointment:update',
  'appointment:cancel',
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

// Monday 9 November 2026, 08:00 in Kinshasa (UTC+1).
const SLOT = { startsAt: '2026-11-09T07:00:00.000Z', endsAt: '2026-11-09T07:20:00.000Z' };

describe.skipIf(!url)('appointments against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-APT-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test rendez-vous',
        displayName: 'Structure de test rendez-vous',
        type: 'clinic',
        status: 'active',
        timezone: 'Africa/Kinshasa',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.insert(schema.scheduleTemplate).values({
        id: uuidv7(),
        tenantId,
        resourceKind: 'practitioner',
        resourceId: doctorId,
        weekday: 1,
        startTime: '08:00',
        endTime: '12:00',
        slotMin: 20,
        overbookMax: 1,
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('holds one booking plus the overbooking; the next device to arrive is refused', async () => {
    const devices = [workstation(), workstation(), workstation()];
    const patients: string[] = [];
    for (const [i, d] of devices.entries()) {
      patients.push(
        (
          await d.client.dispatch('patient.register', {
            mrn: `TST-APT-${i}`,
            familyName: `Patient ${i}`,
            sex: 'F',
          })
        ).entityId,
      );
      await d.client.sync();
    }
    // The three devices book the same slot while offline, then reconnect in turn.
    for (const [i, d] of devices.entries()) {
      await d.client.dispatch('appointment.book', {
        patientId: patients[i] ?? '',
        resourceKind: 'practitioner',
        resourceId: doctorId,
        ...SLOT,
      });
    }
    for (const d of devices) await d.client.sync();

    const booked = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.appointment).where(eq(schema.appointment.resourceId, doctorId)),
    );
    expect(booked).toHaveLength(2);
    // The third device receives the two kept bookings; its own stays marked refused.
    expect(devices[2]?.local.entitiesOf('appointment')).toHaveLength(2);
    const refused = [...(devices[2]?.local.data.entities.values() ?? [])].filter(
      (e) => e.entity === 'appointment' && e.rejected,
    );
    expect(refused).toHaveLength(1);
    const outbox = [...(devices[2]?.local.data.outbox.values() ?? [])];
    expect(outbox.map((o) => o.lastError)).toContain('RDV_SLOT_TAKEN');

    // A cancellation frees the place for the next booking.
    const first = booked[0]?.id ?? '';
    await devices[0]?.client.dispatch(
      'appointment.cancel',
      { cancelReason: 'Patient indisponible' },
      { entityId: first },
    );
    await devices[0]?.client.sync();
    await devices[2]?.client.dispatch('appointment.book', {
      patientId: patients[2] ?? '',
      resourceKind: 'practitioner',
      resourceId: doctorId,
      ...SLOT,
    });
    await devices[2]?.client.sync();
    const now = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select({ status: schema.appointment.status })
        .from(schema.appointment)
        .where(eq(schema.appointment.resourceId, doctorId)),
    );
    expect(now.map((a) => a.status).sort()).toEqual(['booked', 'booked', 'cancelled']);
  });

  it('refuses a time outside the agenda', async () => {
    const d = workstation();
    const { entityId: patientId } = await d.client.dispatch('patient.register', {
      mrn: 'TST-APT-X',
      familyName: 'Hors agenda',
      sex: 'M',
    });
    await d.client.dispatch('appointment.book', {
      patientId,
      resourceKind: 'practitioner',
      resourceId: doctorId,
      startsAt: '2026-11-10T07:00:00.000Z',
      endsAt: '2026-11-10T07:20:00.000Z',
    });
    await d.client.sync();
    const outbox = [...d.local.data.outbox.values()];
    expect(outbox.map((o) => o.lastError)).toContain('RDV_SLOT_UNAVAILABLE');
  });
});
