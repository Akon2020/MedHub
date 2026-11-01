import { stockBalance } from '@medhub/domain';
import { uuidv7, type StockMovementKind } from '@medhub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NetworkError } from '../src/client/engine';
import type { EntityState } from '../src/reducers';
import { createWorld, settle, type Device } from './harness';

const MOVEMENT_KINDS: StockMovementKind[] = [
  'receipt',
  'dispense',
  'sale',
  'adjustment_plus',
  'return_patient',
];
const FAMILY_NAMES = [
  'Ilunga',
  'Kabwe',
  'Mbuyi',
  'Tshibanda',
  'Lukusa',
  'Nzuzi',
  'Kasongo',
  'Mwamba',
];
const GIVEN_NAMES = ['Grâce', 'Espoir', 'Dieudonné', 'Merveille', 'Patience', 'Héritier'];

type Counters = { registers: number; vitals: number; movements: number; dispatched: number };

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('empty');
  return item;
}

async function randomCommand(
  device: Device,
  random: () => number,
  warehouses: string[],
  products: string[],
  counters: Counters,
  index: number,
): Promise<void> {
  const patients = device.store.entitiesOf('patient');
  const vitals = device.store.entitiesOf('vital_sign').filter((v) => v.data.status === 'active');
  const roll = random();

  if (roll < 0.3 || patients.length === 0) {
    await device.client.dispatch('patient.register', {
      mrn: `KIN-${device.id.slice(-4)}-26-${String(index).padStart(5, '0')}`,
      familyName: pick(random, FAMILY_NAMES),
      givenName: pick(random, GIVEN_NAMES),
      sex: random() < 0.5 ? 'F' : 'M',
      birthDateEstimated: false,
      sensitivity: 'normal',
    });
    counters.registers += 1;
  } else if (roll < 0.5) {
    const patient = pick(random, patients);
    const sensitive = random() < 0.2;
    await device.client.dispatch(
      'patient.update',
      sensitive
        ? { familyName: pick(random, FAMILY_NAMES) }
        : { phone: `+243 81 ${Math.floor(random() * 9_000_000 + 1_000_000)}` },
      { entityId: patient.id },
    );
  } else if (roll < 0.75) {
    const patient = pick(random, patients);
    const supersedes = vitals.length > 0 && random() < 0.15 ? pick(random, vitals) : null;
    await device.client.dispatch('vital_sign.record', {
      patientId: patient.id,
      code: 'temp',
      value: Math.round((36 + random() * 4) * 10) / 10,
      unit: '°C',
      measuredAt: new Date(Date.UTC(2026, 9, 1, 8)).toISOString(),
      ...(supersedes ? { supersedesId: supersedes.id } : {}),
    });
    counters.vitals += 1;
  } else {
    await device.client.dispatch('stock_movement.record', {
      warehouseId: pick(random, warehouses),
      productId: pick(random, products),
      kind: pick(random, MOVEMENT_KINDS),
      quantity: 1 + Math.floor(random() * 20),
    });
    counters.movements += 1;
  }
  counters.dispatched += 1;
}

function comparable(states: EntityState[]): Record<string, { version: number; data: unknown }> {
  const out: Record<string, { version: number; data: unknown }> = {};
  for (const s of states) out[s.id] = { version: s.version, data: s.data };
  return out;
}

async function runScenario(seed: number, totalOps: number) {
  const world = createWorld(seed);
  const { random, devices, server, clock } = world;
  const warehouses = [uuidv7(), uuidv7()];
  const products = [uuidv7(), uuidv7(), uuidv7()];
  const counters: Counters = { registers: 0, vitals: 0, movements: 0, dispatched: 0 };

  for (let i = 0; i < totalOps; i += 1) {
    const device = pick(random, devices);
    if (random() < 0.08) {
      device.transport.mode = {
        offline: random() < 0.5,
        failBefore: random() * 0.3,
        loseResponse: random() * 0.3,
      };
    }
    await randomCommand(device, random, warehouses, products, counters, i);
    clock.advance(Math.floor(random() * 5_000));

    if (random() < 0.25) {
      try {
        await device.client.sync();
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }
  }

  await settle(devices);
  return { world, counters, server, devices };
}

function assertConverged(result: Awaited<ReturnType<typeof runScenario>>) {
  const { counters, server, devices } = result;
  const ops = [...server.data.ops.values()];

  expect(ops.length).toBe(counters.dispatched);
  expect(ops.filter((o) => o.result.status === 'rejected')).toEqual([]);
  expect(new Set(ops.map((o) => o.op.opId)).size).toBe(ops.length);

  expect(server.entitiesOf('patient').length).toBe(counters.registers);
  expect(server.entitiesOf('vital_sign').length).toBe(counters.vitals);
  expect(server.entitiesOf('stock_movement').length).toBe(counters.movements);

  for (const device of devices) {
    expect(device.store.data.outbox.size).toBe(0);
    for (const entity of ['patient', 'vital_sign', 'stock_movement'] as const) {
      expect(comparable(device.store.entitiesOf(entity))).toEqual(
        comparable(server.entitiesOf(entity)),
      );
    }
  }

  const movements = server.entitiesOf('stock_movement');
  const keys = new Set(
    movements.map((m) => `${String(m.data.warehouseId)}|${String(m.data.productId)}`),
  );
  for (const key of keys) {
    const [warehouseId, productId] = key.split('|');
    const subset = movements
      .filter((m) => m.data.warehouseId === warehouseId && m.data.productId === productId)
      .map((m) => ({ kind: m.data.kind as StockMovementKind, quantity: Number(m.data.quantity) }));
    for (const device of devices) {
      const local = device.store
        .entitiesOf('stock_movement')
        .filter((m) => m.data.warehouseId === warehouseId && m.data.productId === productId)
        .map((m) => ({
          kind: m.data.kind as StockMovementKind,
          quantity: Number(m.data.quantity),
        }));
      expect(stockBalance(local)).toBe(stockBalance(subset));
    }
  }
}

describe('sync prototype (docs/02-offline-sync.md section 13)', () => {
  // 500 signed operations replayed through outages: over a minute on a loaded machine.
  it('500 operations on two devices with random outages: no loss, no duplicate, convergence', async () => {
    const result = await runScenario(20261029, 500);
    assertConverged(result);
    const total = (key: 'failedBefore' | 'lostResponses' | 'duplicates' | 'conflicts') =>
      result.devices.reduce((n, d) => n + d.transport.stats[key], 0);
    // The scenario must really exercise outages, lost acknowledgements and replays.
    expect(total('failedBefore')).toBeGreaterThan(0);
    expect(total('lostResponses')).toBeGreaterThan(0);
    expect(total('duplicates')).toBeGreaterThan(0);
    console.warn(
      `sync prototype: ${result.counters.dispatched} ops, ${total('failedBefore')} failed pushes, ` +
        `${total('lostResponses')} lost responses, ${total('duplicates')} duplicates, ${total('conflicts')} conflicts`,
    );
  }, 180_000);

  it('converges for any seed (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), async (seed) => {
        assertConverged(await runScenario(seed, 120));
      }),
      { numRuns: 15 },
    );
  }, 120_000);

  it('replaying the same batch is idempotent', async () => {
    const { devices, server } = createWorld(7);
    const device = devices[0];
    if (!device) throw new Error('no device');
    await device.client.dispatch('patient.register', {
      mrn: 'KIN-AA-26-00001',
      familyName: 'Ilunga',
      sex: 'F',
      birthDateEstimated: false,
      sensitivity: 'normal',
    });
    const [item] = [...device.store.data.outbox.values()];
    if (!item) throw new Error('no outbox item');
    const request = { deviceId: device.id, schemaVersion: 1, ops: [item.op] };
    const first = await device.transport.push(request);
    const second = await device.transport.push(request);
    expect(first.results[0]?.status).toBe('applied');
    expect(second.results[0]?.status).toBe('duplicate');
    expect(server.entitiesOf('patient')).toHaveLength(1);
    expect(server.data.changes).toHaveLength(1);
  });
});
