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
import { NetworkError, SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPull, processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgSyncStore } from '@/server/modules/sync';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const PERMISSIONS = new Set([
  'patient:create',
  'patient:update',
  'vital_sign:create',
  'stock:move',
]);
const NAMES = ['Ilunga', 'Kabwe', 'Mbuyi', 'Lukusa', 'Nzuzi', 'Kasongo'];

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let handle: DbHandle;
const tenantId = uuidv7();
const userId = uuidv7();

describe.skipIf(!url)('sync against PostgreSQL', () => {
  beforeAll(async () => {
    handle = createDb(url as string, 6);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-SYN-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test sync',
        displayName: 'Structure de test sync',
        type: 'clinic',
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('two devices, outages and lost acknowledgements: no loss, no duplicate, convergence', async () => {
    const random = prng(4242);
    const clock = new ManualClock(Date.now());
    const devices = [uuidv7(), uuidv7()].map((deviceId) => {
      const store = pgSyncStore(handle.db, { tenantId, userId, deviceId });
      const ctx = {
        tenantId,
        userId,
        deviceId,
        permissions: PERMISSIONS,
        devicePublicKey: null,
        serverTime: () => new Date().toISOString(),
      };
      const mode = { failBefore: 0, loseResponse: 0 };
      const transport: SyncTransport = {
        push: async (req) => {
          if (random() < mode.failBefore) throw new NetworkError();
          const res = await processPush(store, ctx, JSON.parse(JSON.stringify(req)));
          if (random() < mode.loseResponse) throw new NetworkError();
          return JSON.parse(JSON.stringify(res));
        },
        pull: async (cursor, opts) => {
          if (random() < mode.failBefore) throw new NetworkError();
          return JSON.parse(
            JSON.stringify(
              await processPull(store, {
                cursor,
                ...opts,
                nowMs: Date.now(),
                serverTime: toIso(Date.now()),
              }),
            ),
          );
        },
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
      return { deviceId, local, client, mode };
    });

    const warehouse = uuidv7();
    const product = uuidv7();
    let registers = 0;
    let vitals = 0;
    let movements = 0;

    for (let i = 0; i < 160; i += 1) {
      const d = devices[Math.floor(random() * devices.length)];
      if (!d) continue;
      if (random() < 0.1) {
        d.mode.failBefore = random() * 0.3;
        d.mode.loseResponse = random() * 0.3;
      }
      const patients = d.local.entitiesOf('patient');
      const roll = random();
      if (roll < 0.35 || patients.length === 0) {
        await d.client.dispatch('patient.register', {
          mrn: `T-${d.deviceId.slice(-6)}-${i}`,
          familyName: NAMES[Math.floor(random() * NAMES.length)] ?? 'Ilunga',
          sex: random() < 0.5 ? 'F' : 'M',
          birthDateEstimated: false,
          sensitivity: 'normal',
        });
        registers += 1;
      } else if (roll < 0.5) {
        const p = patients[Math.floor(random() * patients.length)];
        if (p) {
          await d.client.dispatch(
            'patient.update',
            { phone: `+243 81 ${Math.floor(random() * 9_000_000 + 1_000_000)}` },
            { entityId: p.id },
          );
        }
      } else if (roll < 0.8) {
        const p = patients[Math.floor(random() * patients.length)];
        if (p) {
          await d.client.dispatch('vital_sign.record', {
            patientId: p.id,
            code: 'temp',
            value: Math.round((36 + random() * 3) * 10) / 10,
            unit: '°C',
            measuredAt: new Date().toISOString(),
          });
          vitals += 1;
        }
      } else {
        await d.client.dispatch('stock_movement.record', {
          warehouseId: warehouse,
          productId: product,
          kind: random() < 0.5 ? 'receipt' : 'dispense',
          quantity: 1 + Math.floor(random() * 10),
        });
        movements += 1;
      }
      clock.advance(1_000);
      if (random() < 0.3) {
        await d.client.sync().catch((error: unknown) => {
          if (!(error instanceof NetworkError)) throw error;
        });
      }
    }

    for (const d of devices) {
      d.mode.failBefore = 0;
      d.mode.loseResponse = 0;
    }
    for (let round = 0; round < 3; round += 1) {
      for (const d of devices) await d.client.sync();
    }

    const counts = await withTenant(handle.db, { tenantId, userId }, async (tx) => ({
      patients: (await tx.select({ id: schema.patient.id }).from(schema.patient)).length,
      vitals: (await tx.select({ id: schema.vitalSign.id }).from(schema.vitalSign)).length,
      movements: (await tx.select({ id: schema.stockMovement.id }).from(schema.stockMovement))
        .length,
      rejected: (await tx.select().from(schema.opLog)).filter((o) => o.status === 'rejected')
        .length,
      chain: await verifyAuditChain(tx, tenantId),
    }));

    expect(counts).toMatchObject({ patients: registers, vitals, movements, rejected: 0 });
    expect(counts.chain.ok).toBe(true);

    const [a, b] = devices;
    if (!a || !b) throw new Error('devices');
    for (const entity of ['patient', 'vital_sign', 'stock_movement'] as const) {
      const left = a.local.entitiesOf(entity).map((e) => [e.id, e.version, e.data]);
      const right = b.local.entitiesOf(entity).map((e) => [e.id, e.version, e.data]);
      expect(left.sort()).toEqual(right.sort());
      expect(left.length).toBe(
        entity === 'patient' ? registers : entity === 'vital_sign' ? vitals : movements,
      );
    }
    expect(a.local.data.outbox.size + b.local.data.outbox.size).toBe(0);
  }, 120_000);
});
