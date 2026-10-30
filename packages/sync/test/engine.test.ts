import { uuidv7 } from '@medhub/shared';
import { describe, expect, it } from 'vitest';
import type { Operation } from '../src/protocol';
import { createWorld } from './harness';

async function pendingOps(device: {
  store: { data: { outbox: Map<string, { op: Operation; seq: number }> } };
}) {
  return [...device.store.data.outbox.values()].sort((a, b) => a.seq - b.seq).map((i) => i.op);
}

function setup(seed = 1) {
  const world = createWorld(seed);
  const [a, b] = world.devices;
  if (!a || !b) throw new Error('devices');
  return { ...world, a, b };
}

const registration = {
  mrn: 'KIN-AA-26-00001',
  familyName: 'Ilunga',
  givenName: 'Grâce',
  sex: 'F' as const,
  birthDateEstimated: false,
  sensitivity: 'normal' as const,
};

describe('server engine', () => {
  it('rejects an operation whose signature was tampered with', async () => {
    const { a, server } = setup();
    await a.client.dispatch('patient.register', registration);
    const [op] = await pendingOps(a);
    if (!op) throw new Error('op');
    const forged = { ...op, payload: { ...(op.payload as object), familyName: 'Autre' } };
    const res = await a.transport.push({ deviceId: a.id, schemaVersion: 1, ops: [forged] });
    expect(res.results[0]).toMatchObject({ status: 'rejected', reason: 'SYNC_SIGNATURE_INVALID' });
    expect(server.entitiesOf('patient')).toHaveLength(0);
  });

  it('rejects an operation for another structure', async () => {
    const { a, b } = setup();
    await a.client.dispatch('patient.register', registration);
    const [op] = await pendingOps(a);
    if (!op) throw new Error('op');
    const res = await b.transport.push({ deviceId: b.id, schemaVersion: 1, ops: [op] });
    expect(res.results[0]?.status).toBe('rejected');
  });

  it('keeps the server value and opens a conflict on a stale sensitive field', async () => {
    const { a, b, server } = setup();
    const { entityId } = await a.client.dispatch('patient.register', registration);
    await a.client.sync();
    await b.client.sync();

    await a.client.dispatch('patient.update', { familyName: 'Ilunga Kabwe' }, { entityId });
    await a.client.sync();
    await b.client.dispatch(
      'patient.update',
      { familyName: 'Ilunga Mbuyi', phone: '+243 81 0000000' },
      { entityId },
    );
    const summary = await b.client.sync();

    expect(summary?.push.conflicts).toBe(1);
    const [patient] = server.entitiesOf('patient');
    expect(patient?.data.familyName).toBe('Ilunga Kabwe');
    expect(patient?.data.phone).toBe('+243 81 0000000');
    expect(server.data.conflicts.size).toBe(1);
    expect(b.store.data.conflicts).toHaveLength(1);
    expect(b.store.entitiesOf('patient')[0]?.data.familyName).toBe('Ilunga Kabwe');
  });

  it('applies field merge by HLC whatever the arrival order', async () => {
    const { a, b, server, clock } = setup();
    const { entityId } = await a.client.dispatch('patient.register', registration);
    await a.client.sync();
    await b.client.sync();

    await a.client.dispatch('patient.update', { phone: '+243 81 1111111' }, { entityId });
    clock.advance(1_000);
    await b.client.dispatch('patient.update', { phone: '+243 81 2222222' }, { entityId });
    await b.client.sync();
    const lateSummary = await a.client.sync();

    expect(lateSummary?.push.acknowledged).toBe(1);
    expect(server.entitiesOf('patient')[0]?.data.phone).toBe('+243 81 2222222');
    await b.client.sync();
    expect(a.store.entitiesOf('patient')[0]?.data.phone).toBe('+243 81 2222222');
  });

  it('marks a corrected vital sign as superseded without deleting it', async () => {
    const { a, server } = setup();
    const { entityId: patientId } = await a.client.dispatch('patient.register', registration);
    const first = await a.client.dispatch('vital_sign.record', {
      patientId,
      code: 'temp',
      value: 39.9,
      unit: '°C',
      measuredAt: '2026-10-29T08:00:00.000Z',
    });
    await a.client.dispatch('vital_sign.record', {
      patientId,
      code: 'temp',
      value: 37.9,
      unit: '°C',
      measuredAt: '2026-10-29T08:00:00.000Z',
      supersedesId: first.entityId,
    });
    await a.client.sync();
    const vitals = server.entitiesOf('vital_sign');
    expect(vitals).toHaveLength(2);
    expect(vitals.find((v) => v.id === first.entityId)?.data.status).toBe('superseded');
  });

  it('refuses an implausible vital sign without a justification', async () => {
    const { a } = setup();
    const { entityId: patientId } = await a.client.dispatch('patient.register', registration);
    await expect(
      a.client.dispatch('vital_sign.record', {
        patientId,
        code: 'weight',
        value: 900,
        unit: 'kg',
        measuredAt: '2026-10-29T08:00:00.000Z',
      }),
    ).rejects.toThrow('DPI_VITAL_IMPLAUSIBLE');
  });

  it('applies a late dispense even if stock goes negative, with a warning', async () => {
    const { a } = setup();
    await a.client.dispatch('stock_movement.record', {
      warehouseId: uuidv7(),
      productId: uuidv7(),
      kind: 'dispense',
      quantity: 3,
    });
    const [op] = await pendingOps(a);
    if (!op) throw new Error('op');
    const res = await a.transport.push({ deviceId: a.id, schemaVersion: 1, ops: [op] });
    expect(res.results[0]).toMatchObject({ status: 'applied', warnings: ['PHAR_NEGATIVE_STOCK'] });
  });

  it('rejects an operation whose dependency was rejected', async () => {
    const { a } = setup();
    const reg = await a.client.dispatch('patient.register', registration);
    await a.client.dispatch(
      'patient.update',
      { phone: '+243 81 3333333' },
      {
        entityId: reg.entityId,
        dependsOn: [reg.opId],
      },
    );
    const [create, update] = await pendingOps(a);
    if (!create || !update) throw new Error('ops');
    const broken = { ...create, signature: 'AAAA' };
    const res = await a.transport.push({ deviceId: a.id, schemaVersion: 1, ops: [broken, update] });
    expect(res.results.map((r) => r.reason)).toEqual([
      'SYNC_SIGNATURE_INVALID',
      'DEPENDENCY_REJECTED',
    ]);
  });
});
