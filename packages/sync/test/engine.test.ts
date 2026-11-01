import { ManualClock, uuidv7 } from '@medhub/shared';
import { describe, expect, it } from 'vitest';
import { SyncClient } from '../src/client/engine';
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

  it('refuses a clinical act dated after a death recorded on another device', async () => {
    const { a, b, server } = setup();
    const { entityId: patientId } = await a.client.dispatch('patient.register', registration);
    await a.client.sync();
    await b.client.sync();

    await a.client.dispatch(
      'patient.mark_deceased',
      { deceasedAt: '2026-10-29T10:00:00.000Z' },
      { entityId: patientId },
    );
    await a.client.sync();
    // B has not pulled yet: one measurement taken before the death, one after.
    const vital = (measuredAt: string) => ({
      patientId,
      code: 'temp' as const,
      value: 37.2,
      unit: '°C',
      measuredAt,
    });
    await b.client.dispatch('vital_sign.record', vital('2026-10-29T09:00:00.000Z'));
    await b.client.dispatch('vital_sign.record', vital('2026-10-29T11:00:00.000Z'));
    const res = await b.transport.push({
      deviceId: b.id,
      schemaVersion: 1,
      ops: await pendingOps(b),
    });
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(['applied', 'PAT_DECEASED']);
    expect(server.entitiesOf('vital_sign')).toHaveLength(1);

    // Once it knows, the device itself refuses the act before queueing it.
    await a.client.sync();
    await expect(
      a.client.dispatch('vital_sign.record', vital('2026-10-29T12:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'PAT_DECEASED' });
  });

  it('withdraws a death declaration only with a reason', async () => {
    const { a, server } = setup();
    const { entityId } = await a.client.dispatch('patient.register', registration);
    await a.client.dispatch(
      'patient.mark_deceased',
      { deceasedAt: '2026-10-29T10:00:00.000Z' },
      { entityId },
    );
    await expect(
      a.client.dispatch('patient.mark_deceased', { deceasedAt: null }, { entityId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await a.client.dispatch(
      'patient.mark_deceased',
      { deceasedAt: null, correctionReason: 'Erreur de dossier' },
      { entityId },
    );
    await a.client.sync();
    expect(server.entitiesOf('patient')[0]?.data.deceasedAt).toBeNull();
  });

  it('marks sensitivity with its own permission, the reason staying in the log', async () => {
    const { a, server } = setup();
    const { entityId } = await a.client.dispatch('patient.register', registration);
    await a.client.dispatch(
      'patient.set_sensitivity',
      { sensitivity: 'staff', sensitivityReason: 'Agent de la structure' },
      { entityId },
    );
    // A plain identity update cannot carry the level.
    await a.client.dispatch(
      'patient.update',
      { phone: '+243 81 4444444', sensitivity: 'normal' } as never,
      { entityId },
    );
    await a.client.sync();
    const [patient] = server.entitiesOf('patient');
    expect(patient?.data).toMatchObject({ sensitivity: 'staff', phone: '+243 81 4444444' });
    expect(patient?.data).not.toHaveProperty('sensitivityReason');
  });

  it('drops a patient and its rows when the server says it left the device', async () => {
    const { a } = setup();
    const { entityId: patientId } = await a.client.dispatch('patient.register', registration);
    await a.client.dispatch('vital_sign.record', {
      patientId,
      code: 'temp',
      value: 37,
      unit: '°C',
      measuredAt: '2026-10-29T08:00:00.000Z',
    });
    await a.client.sync();
    const evicting = new SyncClient({
      store: a.store,
      transport: {
        push: async () => ({ results: [], serverTime: '2026-10-29T09:00:00.000Z' }),
        pull: async () => ({
          changes: [
            {
              seq: 99,
              entity: 'patient',
              entityId: patientId,
              version: 2,
              data: null,
              evict: true,
            },
          ],
          nextCursor: 99,
          hasMore: false,
          serverTime: '2026-10-29T09:00:00.000Z',
        }),
      },
      clock: new ManualClock(Date.UTC(2026, 9, 29, 9)),
      identity: { tenantId: uuidv7(), siteId: null, userId: uuidv7(), deviceId: a.id },
      sign: (op) => ({ ...op, signature: '' }),
      permissions: new Set<string>(),
    });
    await evicting.pull();
    expect(a.store.entitiesOf('patient')).toEqual([]);
    expect(a.store.entitiesOf('vital_sign')).toEqual([]);
  });

  it('keeps the first call of a ticket called by two devices offline', async () => {
    const { a, b, server } = setup();
    const { entityId: patientId } = await a.client.dispatch('patient.register', registration);
    const { entityId: ticketId } = await a.client.dispatch('queue_ticket.issue', {
      queueId: '01a19830-805e-7768-a65f-140ecc61aab9',
      patientId,
      number: 'C-AA-001',
      issuedAt: '2026-11-02T08:00:00.000Z',
    });
    await a.client.sync();
    await b.client.sync();

    await a.client.dispatch(
      'queue_ticket.call',
      { calledAt: '2026-11-02T08:10:00.000Z', room: 'Salle 1' },
      { entityId: ticketId },
    );
    await b.client.dispatch(
      'queue_ticket.call',
      { calledAt: '2026-11-02T08:11:00.000Z', room: 'Salle 2' },
      { entityId: ticketId },
    );
    // On B the ticket already looks called: a second local call is refused.
    await expect(
      b.client.dispatch(
        'queue_ticket.call',
        { calledAt: '2026-11-02T08:12:00.000Z' },
        { entityId: ticketId },
      ),
    ).rejects.toMatchObject({ code: 'RDV_TRANSITION_NOT_ALLOWED' });

    const first = await a.transport.push({
      deviceId: a.id,
      schemaVersion: 1,
      ops: await pendingOps(a),
    });
    expect(first.results[0]?.status).toBe('applied');
    const second = await b.transport.push({
      deviceId: b.id,
      schemaVersion: 1,
      ops: await pendingOps(b),
    });
    expect(second.results[0]).toMatchObject({ status: 'merged', warnings: ['TRANSITION_IGNORED'] });
    const ticket = server.entitiesOf('queue_ticket')[0];
    expect(ticket?.data).toMatchObject({ status: 'called', room: 'Salle 1' });

    await a.client.sync();
    await b.client.sync();
    expect(b.store.entitiesOf('queue_ticket')[0]?.data).toMatchObject({ room: 'Salle 1' });
  });
});
