import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { bytesToBase64, generateDeviceKeyPair, signOperation } from '@medhub/sync';
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
const userId = uuidv7();
const PERMISSIONS = [
  'patient:create',
  'patient:read',
  'clinical_record:read',
  'clinical_record:sign',
  'diagnosis:read',
  'diagnosis:create',
  'configuration:read',
  'configuration:edit',
];

let handle: DbHandle;
type Consultation = typeof import('@/server/modules/dpi/consultation');
let consultation: Consultation;

const ctx = () => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

let devices = 0;

/** A workstation whose operations are signed with its own Ed25519 key, or not signed at all. */
async function workstation(signed: boolean) {
  const deviceId = uuidv7();
  const keys = generateDeviceKeyPair();
  const publicKey = bytesToBase64(keys.publicKey);
  await tenantTx((tx) =>
    tx.insert(schema.device).values({
      id: deviceId,
      tenantId,
      userId,
      deviceCode: `C${String.fromCharCode(65 + devices++)}`,
      name: 'Poste de consultation',
      kind: 'laptop',
      publicKey,
    }),
  );
  const permissions = new Set(PERMISSIONS);
  const store = pgSyncStore(handle.db, { tenantId, userId, deviceId });
  const syncCtx = {
    tenantId,
    userId,
    deviceId,
    permissions,
    devicePublicKey: signed ? publicKey : null,
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
    sign: (op) => (signed ? signOperation(op, keys.secretKey) : { ...op, signature: '' }),
    permissions,
  });
}

const SECTIONS = {
  complaint: 'Fièvre depuis trois jours',
  history: null,
  examination: 'Température 38,9',
  assessment: 'Accès fébrile',
  plan: 'Goutte épaisse',
};

describe.skipIf(!url)('consultation notes and diagnoses against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    consultation = await import('@/server/modules/dpi/consultation');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-CSL-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test consultation',
        displayName: 'Structure de test consultation',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tenantTx(async (tx) => {
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

  it('stores the signed operation with the note, verifiable later; a correction keeps the first note', async () => {
    const d = await workstation(true);
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-CSL-1',
      familyName: 'Kanyinda',
      sex: 'M',
    });
    const { entityId: noteId } = await d.dispatch('clinical_note.sign', {
      patientId,
      kind: 'consultation',
      sections: SECTIONS,
      signedAt: new Date().toISOString(),
    });
    await d.sync();

    const [note] = await tenantTx((tx) =>
      tx.select().from(schema.clinicalNote).where(eq(schema.clinicalNote.id, noteId)),
    );
    expect(note).toMatchObject({ status: 'active', signedBy: userId });
    expect(note?.signedOperation).not.toBeNull();
    expect(await tenantTx((tx) => consultation.verifyNoteSignature(tx, noteId))).toBe(true);

    const { entityId: fixId } = await d.dispatch('clinical_note.sign', {
      patientId,
      kind: 'consultation',
      sections: { ...SECTIONS, assessment: 'Paludisme simple' },
      signedAt: new Date().toISOString(),
      supersedesId: noteId,
      correctionReason: 'Résultat de la goutte épaisse',
    });
    await d.sync();
    const notes = await tenantTx((tx) =>
      tx.select().from(schema.clinicalNote).where(eq(schema.clinicalNote.patientId, patientId)),
    );
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === noteId)?.status).toBe('superseded');
    expect(notes.find((n) => n.id === fixId)).toMatchObject({
      status: 'active',
      correctionReason: 'Résultat de la goutte épaisse',
    });
    expect(await tenantTx((tx) => consultation.verifyNoteSignature(tx, fixId))).toBe(true);

    const events = await tenantTx((tx) =>
      tx.select().from(schema.clinicalEvent).where(eq(schema.clinicalEvent.patientId, patientId)),
    );
    expect(events.filter((e) => e.kind === 'note')).toHaveLength(2);
  });

  it('does not vouch for a note whose operation carries no valid signature', async () => {
    const d = await workstation(false);
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-CSL-2',
      familyName: 'Ilunga',
      sex: 'F',
    });
    const { entityId: noteId } = await d.dispatch('clinical_note.sign', {
      patientId,
      kind: 'consultation',
      sections: SECTIONS,
      signedAt: new Date().toISOString(),
    });
    await d.sync();
    expect(await tenantTx((tx) => consultation.verifyNoteSignature(tx, noteId))).toBe(false);
  });

  it('records coded and free diagnoses, a correction supersedes the previous one', async () => {
    const d = await workstation(true);
    const { entityId: patientId } = await d.dispatch('patient.register', {
      mrn: 'TST-CSL-3',
      familyName: 'Mwamba',
      sex: 'F',
    });
    const { entityId: first } = await d.dispatch('diagnosis.add', {
      patientId,
      codeSystem: 'ICD10',
      code: 'B54',
      label: 'Paludisme',
      certainty: 'suspected',
      isPrimary: true,
      diagnosedAt: new Date().toISOString(),
    });
    await d.dispatch('diagnosis.add', {
      patientId,
      label: 'Anémie modérée',
      certainty: 'confirmed',
      diagnosedAt: new Date().toISOString(),
    });
    await d.dispatch('diagnosis.add', {
      patientId,
      codeSystem: 'ICD10',
      code: 'B50.9',
      label: 'Paludisme à falciparum',
      certainty: 'confirmed',
      isPrimary: true,
      diagnosedAt: new Date().toISOString(),
      supersedesId: first,
    });
    await d.sync();
    const rows = await tenantTx((tx) =>
      tx.select().from(schema.diagnosis).where(eq(schema.diagnosis.patientId, patientId)),
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === first)?.status).toBe('superseded');
    expect(rows.filter((r) => r.status === 'active').map((r) => r.code ?? null)).toEqual(
      expect.arrayContaining(['B50.9', null]),
    );
  });

  it('checks a diagnosis list before importing it, then renames a code already present', async () => {
    const csv = 'code;libelle\nA09;Diarrhée infectieuse\nJ18.9;Pneumopathie\n';
    const checked = await consultation.importDiagnoses(ctx(), { csv, apply: false }, { ip: null });
    expect(checked).toMatchObject({ items: 2, errors: [], total: 0 });

    const bad = 'code;libelle\nXX;Mauvais code\n';
    await expect(
      consultation.importDiagnoses(ctx(), { csv: bad, apply: true }, { ip: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await consultation.importDiagnoses(ctx(), { csv, apply: true }, { ip: null });
    const renamed = 'code;libelle\nA09;Diarrhée et gastro-entérite\n';
    const out = await consultation.importDiagnoses(
      ctx(),
      { csv: renamed, apply: true },
      { ip: null },
    );
    expect(out.total).toBe(2);
    const list = await tenantTx((tx) => consultation.activeDiagnoses(tx));
    expect(list.find((i) => i.code === 'A09')?.label).toBe('Diarrhée et gastro-entérite');
  });
});
