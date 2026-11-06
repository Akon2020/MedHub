import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { consultationGeneral, type FormDefinition } from '@medhub/forms';
import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { SyncClient, type SyncTransport } from '@medhub/sync/client';
import { processPush } from '@medhub/sync/server';
import { MemoryClientStore } from '@medhub/sync/testing';
import { config } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
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
  'clinical_record:create',
  'clinical_record:sign',
  'form:read',
  'form:design',
  'form:publish',
];

let handle: DbHandle;
type Forms = typeof import('@/server/modules/form/service');
let forms: Forms;

const ctx = () => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});
const client = { ip: null };
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

function workstation() {
  const deviceId = uuidv7();
  const permissions = new Set(PERMISSIONS);
  const store = pgSyncStore(handle.db, { tenantId, userId, deviceId });
  const syncCtx = {
    tenantId,
    userId,
    deviceId,
    permissions,
    devicePublicKey: null,
    serverTime: () => new Date().toISOString(),
  };
  const transport: SyncTransport = {
    push: async (req) =>
      JSON.parse(
        JSON.stringify(await processPush(store, syncCtx, JSON.parse(JSON.stringify(req)))),
      ),
    pull: async () => ({ changes: [], nextCursor: 0, hasMore: false, serverTime: toIso(0) }),
  };
  const local = new MemoryClientStore();
  return {
    local,
    client: new SyncClient({
      store: local,
      transport,
      clock: new ManualClock(Date.now()),
      identity: { tenantId, siteId: null, userId, deviceId },
      sign: (op) => ({ ...op, signature: '' }),
      permissions,
    }),
  };
}

/** The diabetes follow-up of the acceptance criterion: a condition and a calculation. */
const diabetes: FormDefinition = {
  schemaVersion: 1,
  code: 'suivi_diabete',
  title: { fr: 'Suivi diabète' },
  step: 'chronic_followup',
  sections: [
    {
      id: 'follow',
      title: { fr: 'Suivi' },
      fields: [
        { id: 'hypo', type: 'yes_no', label: { fr: 'Hypoglycémie' }, required: true },
        {
          id: 'hypo_count',
          type: 'number',
          label: { fr: 'Épisodes' },
          visibleIf: "value('hypo') == true",
        },
        { id: 'insulin', type: 'number', label: { fr: 'Insuline (UI/kg)' } },
        {
          id: 'daily',
          type: 'calculation',
          label: { fr: 'Dose' },
          expression: "value('insulin') * vital('weight')",
        },
      ],
    },
  ],
};

describe.skipIf(!url)('clinical forms against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    forms = await import('@/server/modules/form/service');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-FRM-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test formulaires',
        displayName: 'Structure de test formulaires',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tenantTx(async (tx) => {
      const roleId = uuidv7();
      await tx.insert(schema.role).values({ id: roleId, tenantId, code: 'ref', name: 'Référent' });
      await tx
        .insert(schema.rolePermission)
        .values(PERMISSIONS.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
      await tx.insert(schema.userAccount).values({
        id: userId,
        tenantId,
        username: 'ref',
        displayName: 'Médecin référent',
        passwordHash: 'x',
      });
      await tx.insert(schema.userRole).values({ id: uuidv7(), tenantId, userId, roleId });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('publishes a checked version, freezes it and archives it at the next publication', async () => {
    const draft = await forms.saveFormDraft(ctx(), { definition: diabetes }, client);
    expect(draft.version).toBe(1);
    const again = await forms.saveFormDraft(
      ctx(),
      { definitionId: draft.definitionId, definition: { ...diabetes, title: { fr: 'Diabète' } } },
      client,
    );
    expect(again).toMatchObject({ versionId: draft.versionId, version: 1 });
    await forms.publishForm(ctx(), { definitionId: draft.definitionId }, client);

    // A published version never changes, even by a direct statement.
    await expect(
      tenantTx((tx) =>
        tx
          .update(schema.formVersion)
          .set({ definition: { code: 'x' } })
          .where(eq(schema.formVersion.id, draft.versionId)),
      ),
    ).rejects.toThrow();

    const broken = {
      ...diabetes,
      sections: [
        {
          ...diabetes.sections[0]!,
          fields: [
            { id: 'hypo', type: 'text', label: { fr: 'Changé de type' } },
            { id: 'x', type: 'text', label: { fr: 'X' }, visibleIf: 'this.constructor' },
          ],
        },
      ],
    };
    const next = await forms.saveFormDraft(
      ctx(),
      { definitionId: draft.definitionId, definition: broken },
      client,
    );
    expect(next.version).toBe(2);
    await expect(
      forms.publishForm(ctx(), { definitionId: draft.definitionId }, client),
    ).rejects.toMatchObject({ code: 'FORM_INVALID' });

    await forms.saveFormDraft(
      ctx(),
      {
        definitionId: draft.definitionId,
        definition: {
          ...diabetes,
          sections: [
            {
              ...diabetes.sections[0]!,
              fields: [
                ...diabetes.sections[0]!.fields,
                { id: 'feet', type: 'textarea', label: { fr: 'Examen des pieds' } },
              ],
            },
          ],
        },
      },
      client,
    );
    await forms.publishForm(ctx(), { definitionId: draft.definitionId }, client);
    const versions = await tenantTx((tx) => forms.publishedFormVersions(tx));
    expect(versions.filter((v) => v.definitionId === draft.definitionId)).toMatchObject([
      { version: 1, status: 'archived' },
      { version: 2, status: 'published' },
    ]);
  });

  it('refuses a duplicate code for another form', async () => {
    const other = await forms.saveFormDraft(
      ctx(),
      { definition: { ...consultationGeneral, code: 'consultation_test' } },
      client,
    );
    await expect(
      forms.saveFormDraft(
        ctx(),
        { definitionId: other.definitionId, definition: { ...diabetes } },
        client,
      ),
    ).rejects.toMatchObject({ code: 'FORM_CODE_TAKEN' });
  });

  it('keeps a response with its version and refuses answers that do not fit it', async () => {
    const { definitionId } = await forms.saveFormDraft(
      ctx(),
      { definition: { ...diabetes, code: 'diabete_reponses' } },
      client,
    );
    const { versionId } = await forms.publishForm(ctx(), { definitionId }, client);
    const draftOnly = await forms.saveFormDraft(
      ctx(),
      { definition: { ...diabetes, code: 'jamais_publie' } },
      client,
    );

    const d = workstation();
    const { entityId: patientId } = await d.client.dispatch('patient.register', {
      mrn: 'TST-FRM-1',
      familyName: 'Lukusa',
      sex: 'F',
    });
    const base = {
      patientId,
      formVersionId: versionId,
      formCode: 'diabete_reponses',
      completedAt: new Date().toISOString(),
    };
    const good = await d.client.dispatch('form_response.complete', {
      ...base,
      data: { hypo: true, hypo_count: 2, insulin: 0.5, daily: 40 },
    });
    const bad = await d.client.dispatch('form_response.complete', {
      ...base,
      data: { hypo: 'oui' },
    });
    const unpublished = await d.client.dispatch('form_response.sign', {
      ...base,
      formVersionId: draftOnly.versionId,
      formCode: 'jamais_publie',
      data: { hypo: false },
    });
    await d.client.sync();

    const rows = await tenantTx((tx) =>
      tx.select().from(schema.formResponse).where(eq(schema.formResponse.patientId, patientId)),
    );
    expect(rows.map((r) => r.id)).toEqual([good.entityId]);
    expect(rows[0]).toMatchObject({ formVersionId: versionId, state: 'completed' });
    const results = await tenantTx((tx) =>
      tx
        .select({ opId: schema.opLog.opId, reason: sql<string>`${schema.opLog.result}->>'reason'` })
        .from(schema.opLog)
        .where(eq(schema.opLog.entityId, bad.entityId)),
    );
    expect(results[0]?.reason).toBe('FORM_RESPONSE_INVALID');
    const unpublishedOp = await tenantTx((tx) =>
      tx
        .select({ reason: sql<string>`${schema.opLog.result}->>'reason'` })
        .from(schema.opLog)
        .where(eq(schema.opLog.entityId, unpublished.entityId)),
    );
    expect(unpublishedOp[0]?.reason).toBe('FORM_VERSION_UNKNOWN');
    expect(d.local.entitiesOf('form_response').map((e) => e.id)).toEqual([good.entityId]);

    const events = await tenantTx((tx) =>
      tx.select().from(schema.clinicalEvent).where(eq(schema.clinicalEvent.patientId, patientId)),
    );
    expect(events.filter((e) => e.kind === 'form_response')).toHaveLength(1);
  });
});
