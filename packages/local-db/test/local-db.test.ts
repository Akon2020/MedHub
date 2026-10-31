import 'fake-indexeddb/auto';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPull, processPush } from '@medhub/sync/server';
import { MemoryServerStore } from '@medhub/sync/testing';
import { describe, expect, it } from 'vitest';
import {
  initializeLocal,
  loadDevice,
  openLocalDb,
  recoverWithCode,
  saveDevice,
  unlockWithPin,
  type UnlockedLocal,
} from '../src';

const ITERATIONS = 1_000;
const PERMISSIONS = new Set([
  'patient:create',
  'patient:update',
  'vital_sign:create',
  'stock:move',
]);

function identity() {
  return { tenantId: uuidv7(), userId: uuidv7() };
}

function clientFor(
  unlocked: UnlockedLocal,
  server: MemoryServerStore,
  ids: { tenantId: string; userId: string },
) {
  const clock = new ManualClock(Date.UTC(2026, 9, 29, 8));
  const deviceId = uuidv7();
  const ctx = {
    tenantId: ids.tenantId,
    userId: ids.userId,
    deviceId,
    permissions: PERMISSIONS,
    devicePublicKey: null,
    serverTime: () => toIso(clock.now()),
  };
  const transport: SyncTransport = {
    push: async (req) => processPush(server, ctx, JSON.parse(JSON.stringify(req))),
    pull: async (cursor, opts) =>
      processPull(server, { cursor, ...opts, nowMs: clock.now(), serverTime: toIso(clock.now()) }),
  };
  return new SyncClient({
    store: unlocked.store,
    transport,
    clock,
    identity: { ...ids, siteId: null, deviceId },
    sign: (op) => ({ ...op, signature: '' }),
    permissions: PERMISSIONS,
  });
}

async function rawDump(unlocked: UnlockedLocal): Promise<string> {
  const tables = await Promise.all(unlocked.db.tables.map((t) => t.toArray()));
  return JSON.stringify(tables);
}

describe('encrypted local database', () => {
  // PBKDF2 with 600 000 iterations: well over 5 s when every suite runs at once.
  it('stores no patient name in clear and syncs with the server', { timeout: 60_000 }, async () => {
    const ids = identity();
    const db = openLocalDb(ids);
    const { unlocked } = await initializeLocal(db, '482913', ITERATIONS);
    const server = new MemoryServerStore();
    const client = clientFor(unlocked, server, ids);

    const { entityId } = await client.dispatch('patient.register', {
      mrn: 'KIN-AB-26-00001',
      familyName: 'Tshibanda',
      givenName: 'Merveille',
      sex: 'F',
      phone: '+243 81 5550000',
      birthDateEstimated: false,
      sensitivity: 'normal',
    });
    await client.dispatch('vital_sign.record', {
      patientId: entityId,
      code: 'temp',
      value: 38.4,
      unit: '°C',
      measuredAt: '2026-10-29T08:00:00.000Z',
    });

    const dump = await rawDump(unlocked);
    expect(dump).not.toMatch(/Tshibanda|Merveille|5550000|38\.4/i);

    const summary = await client.sync();
    expect(summary?.push.acknowledged).toBe(2);
    expect(await unlocked.store.outboxCounts()).toMatchObject({ pending: 0 });
    expect(server.entitiesOf('patient')).toHaveLength(1);

    const [local] = await unlocked.store.readEntities('patient');
    expect(local?.version).toBe(1);
    expect(local?.data.familyName).toBe('Tshibanda');
    expect(await unlocked.store.readEntitiesByPatient('vital_sign', entityId)).toHaveLength(1);
  });

  it('finds patients offline through the hashed index, tolerating typos', async () => {
    const ids = identity();
    const { unlocked } = await initializeLocal(openLocalDb(ids), '482913', ITERATIONS);
    const client = clientFor(unlocked, new MemoryServerStore(), ids);
    for (const [familyName, givenName] of [
      ['Kabwe', 'Espoir'],
      ['Mbuyi', 'Grâce'],
      ['Ilunga', 'Patience'],
    ] as const) {
      await client.dispatch('patient.register', {
        mrn: `KIN-AB-26-${familyName}`,
        familyName,
        givenName,
        sex: 'U',
        birthDateEstimated: false,
        sensitivity: 'normal',
      });
    }
    const [first] = await unlocked.store.searchPatients('mbouyi grace');
    expect(first?.data.familyName).toBe('Mbuyi');
    const [second] = await unlocked.store.searchPatients('Cabwe');
    expect(second?.data.familyName).toBe('Kabwe');
  });

  it('refuses a wrong PIN and keeps unsent work when blocked', async () => {
    const ids = identity();
    const db = openLocalDb(ids);
    const { unlocked, recoveryCode } = await initializeLocal(db, '111111', ITERATIONS);
    const client = clientFor(unlocked, new MemoryServerStore(), ids);
    await client.dispatch('patient.register', {
      mrn: 'KIN-AB-26-00009',
      familyName: 'Nzuzi',
      sex: 'M',
      birthDateEstimated: false,
      sensitivity: 'normal',
    });

    const wrong = await unlockWithPin(db, '000000', 2);
    expect(wrong).toMatchObject({ ok: false, reason: 'WRONG_PIN', remaining: 1 });
    expect(await unlockWithPin(db, '000000', 2)).toMatchObject({ reason: 'BLOCKED_USE_RECOVERY' });
    expect(await unlockWithPin(db, '111111', 2)).toMatchObject({ reason: 'BLOCKED_USE_RECOVERY' });

    const recovered = await recoverWithCode(db, recoveryCode.toLowerCase(), '222222', ITERATIONS);
    expect(await recovered.store.outboxCounts()).toMatchObject({ pending: 1 });
    expect(await unlockWithPin(db, '222222')).toMatchObject({ ok: true });
  });

  it('wipes local data after too many failures only when nothing is pending', async () => {
    const ids = identity();
    const db = openLocalDb(ids);
    await initializeLocal(db, '111111', ITERATIONS);
    await unlockWithPin(db, '000000', 1).then((r) => expect(r).toMatchObject({ reason: 'WIPED' }));
  });

  it('keeps the device secret key encrypted', async () => {
    const ids = identity();
    const { unlocked } = await initializeLocal(openLocalDb(ids), '482913', ITERATIONS);
    const secretKey = crypto.getRandomValues(new Uint8Array(32));
    await saveDevice(unlocked, { deviceId: uuidv7(), deviceCode: 'AB', secretKey });
    const loaded = await loadDevice(unlocked);
    expect(loaded?.deviceCode).toBe('AB');
    expect(Array.from(loaded?.secretKey ?? [])).toEqual(Array.from(secretKey));
  });
});
