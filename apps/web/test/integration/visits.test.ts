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
const queueId = uuidv7();
const PERMISSIONS = new Set([
  'patient:create',
  'patient:read',
  'patient:mark_deceased',
  'encounter:create',
  'encounter:read',
  'queue:read',
  'queue:call',
]);

let handle: DbHandle;

function workstation(code: string) {
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
  return { code, client, local };
}

describe.skipIf(!url)('visits and queue tickets against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-VIS-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test files',
        displayName: 'Structure de test files',
        type: 'clinic',
        status: 'active',
      }),
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('opens a visit with its ticket offline, and keeps the first of two calls', async () => {
    const desk = workstation('AA');
    const { entityId: patientId } = await desk.client.dispatch('patient.register', {
      mrn: 'TST-VIS-1',
      familyName: 'Mukendi',
      sex: 'M',
    });
    const visit = await desk.client.dispatch('encounter.open', {
      patientId,
      kind: 'outpatient',
      visitNumber: 'KIN-AA-2026-000001',
      startedAt: '2026-11-02T08:00:00.000Z',
    });
    const { entityId: ticketId } = await desk.client.dispatch(
      'queue_ticket.issue',
      {
        queueId,
        patientId,
        encounterId: visit.entityId,
        number: 'C-AA-001',
        issuedAt: '2026-11-02T08:00:00.000Z',
      },
      { dependsOn: [visit.opId] },
    );
    await desk.client.sync();

    const nurse = workstation('BB');
    const doctor = workstation('CC');
    await nurse.client.sync();
    await doctor.client.sync();
    await nurse.client.dispatch(
      'queue_ticket.call',
      { calledAt: '2026-11-02T08:20:00.000Z', room: 'Triage' },
      { entityId: ticketId },
    );
    await doctor.client.dispatch(
      'queue_ticket.call',
      { calledAt: '2026-11-02T08:21:00.000Z', room: 'Salle 3' },
      { entityId: ticketId },
    );
    await nurse.client.sync();
    await doctor.client.sync();
    await nurse.client.sync();

    const [ticket] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.queueTicket).where(eq(schema.queueTicket.id, ticketId)),
    );
    expect(ticket).toMatchObject({ status: 'called', room: 'Triage', number: 'C-AA-001' });
    const ops = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select({ status: schema.opLog.status })
        .from(schema.opLog)
        .where(eq(schema.opLog.command, 'queue_ticket.call')),
    );
    // Both calls are in the log; only the first changed the ticket.
    expect(ops.map((o) => o.status).sort()).toEqual(['applied', 'merged']);
    expect(doctor.local.entitiesOf('queue_ticket')[0]?.data).toMatchObject({ room: 'Triage' });

    const [row] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.encounter).where(eq(schema.encounter.id, visit.entityId)),
    );
    expect(row).toMatchObject({ status: 'arrived', visitNumber: 'KIN-AA-2026-000001' });
  });

  it('refuses a new visit once the death is recorded', async () => {
    const desk = workstation('DD');
    const { entityId: patientId } = await desk.client.dispatch('patient.register', {
      mrn: 'TST-VIS-2',
      familyName: 'Ilunga',
      sex: 'F',
    });
    await desk.client.dispatch(
      'patient.mark_deceased',
      { deceasedAt: '2026-11-02T07:00:00.000Z' },
      { entityId: patientId },
    );
    await expect(
      desk.client.dispatch('encounter.open', {
        patientId,
        kind: 'emergency',
        visitNumber: 'KIN-DD-2026-000001',
        startedAt: '2026-11-02T08:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PAT_DECEASED' });
  });
});
