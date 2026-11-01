import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { patientSearchFields } from '@medhub/domain';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const reviewerId = uuidv7();
const clerkId = uuidv7();
const [survivorId, mergedId] = [uuidv7(), uuidv7()];
const candidateId = uuidv7();
const vitalId = uuidv7();
const client = { ip: '203.0.113.70' };

let handle: DbHandle;
type Merge = typeof import('@/server/modules/pat/merge');
type Sync = typeof import('@/server/modules/sync');
type Ctx = Parameters<Merge['mergePatients']>[0];
let merge: Merge;
let sync: Sync;
let mergeId = '';

function ctxFor(userId: string): Ctx {
  return { tenantId, userId, sessionId: uuidv7(), deviceId: null, mfaVerifiedAt: null };
}

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) ? error.code : error).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

async function patient(id: string) {
  const [row] = await tx((t) => t.select().from(schema.patient).where(eq(schema.patient.id, id)));
  if (!row) throw new Error(id);
  return row;
}

describe.skipIf(!url)('supervised patient merge against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 10).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    merge = await import('@/server/modules/pat/merge');
    sync = await import('@/server/modules/sync');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (t) =>
      t.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-MRG-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test fusion',
        displayName: 'Structure de test fusion',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tx(async (t) => {
      const reviewerRole = uuidv7();
      const clerkRole = uuidv7();
      await t.insert(schema.role).values([
        { id: reviewerRole, tenantId, code: 'reviewer', name: 'Revue' },
        { id: clerkRole, tenantId, code: 'receptionist', name: 'Accueil' },
      ]);
      await t.insert(schema.rolePermission).values([
        { tenantId, roleId: reviewerRole, permissionKey: 'patient:merge' },
        { tenantId, roleId: clerkRole, permissionKey: 'patient:read' },
      ]);
      await t.insert(schema.userAccount).values([
        {
          id: reviewerId,
          tenantId,
          username: 'revue',
          displayName: 'Revue fictive',
          passwordHash: 'x',
        },
        {
          id: clerkId,
          tenantId,
          username: 'accueil',
          displayName: 'Accueil fictif',
          passwordHash: 'x',
        },
      ]);
      await t.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: reviewerId, roleId: reviewerRole },
        { id: uuidv7(), tenantId, userId: clerkId, roleId: clerkRole },
      ]);
      const person = { familyName: 'Kabila', givenName: 'Jean' };
      await t.insert(schema.patient).values([
        {
          id: survivorId,
          tenantId,
          mrn: 'TST-A',
          ...person,
          sex: 'M',
          birthDate: '1990-01-01',
          birthDateEstimated: true,
          ...patientSearchFields(person),
        },
        {
          id: mergedId,
          tenantId,
          mrn: 'TST-B',
          ...person,
          sex: 'M',
          birthDate: '1990-03-12',
          phone: '0991234567',
          ...patientSearchFields({ ...person, phone: '0991234567' }),
        },
      ]);
      await t.insert(schema.vitalSign).values({
        id: vitalId,
        tenantId,
        patientId: mergedId,
        code: 'temp',
        value: 38.5,
        unit: 'Cel',
        measuredAt: new Date(),
      });
      const [a, b] = survivorId < mergedId ? [survivorId, mergedId] : [mergedId, survivorId];
      await t.insert(schema.duplicateCandidate).values({
        id: candidateId,
        tenantId,
        patientAId: a,
        patientBId: b,
        score: 95,
      });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('is reserved to patient:merge', async () => {
    await expectCode(
      merge.mergePatients(
        ctxFor(clerkId),
        { survivorId, mergedId, keep: {}, reason: 'Doublon P3' },
        client,
      ),
      'PERMISSION_DENIED',
    );
  });

  it('keeps the chosen values on the survivor and points the merged record to it', async () => {
    ({ mergeId } = await merge.mergePatients(
      ctxFor(reviewerId),
      {
        survivorId,
        mergedId,
        keep: { birthDate: 'merged', phone: 'merged' },
        reason: 'Même personne : même téléphone, date exacte connue',
        candidateId,
      },
      client,
    ));
    expect(await patient(survivorId)).toMatchObject({
      birthDate: '1990-03-12',
      birthDateEstimated: false,
      phone: '0991234567',
      version: 2,
      mergedIntoId: null,
    });
    expect(await patient(mergedId)).toMatchObject({ mergedIntoId: survivorId, version: 2 });
    const [vital] = await tx((t) =>
      t.select().from(schema.vitalSign).where(eq(schema.vitalSign.id, vitalId)),
    );
    expect(vital).toMatchObject({ patientId: mergedId, status: 'active', version: 1 });
    const changes = await tx((t) =>
      t.select().from(schema.changeLog).where(eq(schema.changeLog.entity, 'patient')),
    );
    expect(changes.map((c) => c.entityId).sort()).toEqual([mergedId, survivorId].sort());
    const [pair] = await tx((t) => t.select().from(schema.duplicateCandidate));
    expect(pair).toMatchObject({ status: 'merged', decidedBy: reviewerId });
    await expectCode(
      merge.mergePatients(
        ctxFor(reviewerId),
        { survivorId, mergedId, keep: {}, reason: 'Encore' },
        client,
      ),
      'PAT_ALREADY_MERGED',
    );
    const { merges } = await merge.listMerges(ctxFor(reviewerId));
    expect(merges[0]).toMatchObject({
      id: mergeId,
      status: 'active',
      fields: ['birthDate', 'birthDateEstimated', 'phone'],
    });
  });

  it('undoes the merge without overwriting a value changed since', async () => {
    await tx((t) =>
      sync.updateServerPatient(t, { tenantId, userId: reviewerId }, survivorId, {
        phone: '0811111111',
      }),
    );
    expect(
      await merge.unmergePatients(
        ctxFor(reviewerId),
        { mergeId, reason: 'Fusion par erreur' },
        client,
      ),
    ).toEqual({ kept: ['phone'] });
    expect(await patient(survivorId)).toMatchObject({
      birthDate: '1990-01-01',
      birthDateEstimated: true,
      phone: '0811111111',
    });
    expect((await patient(mergedId)).mergedIntoId).toBeNull();
    const [pair] = await tx((t) =>
      t
        .select()
        .from(schema.duplicateCandidate)
        .where(and(eq(schema.duplicateCandidate.id, candidateId))),
    );
    expect(pair?.status).toBe('open');
    await expectCode(
      merge.unmergePatients(ctxFor(reviewerId), { mergeId, reason: 'Encore' }, client),
      'PAT_MERGE_UNDONE',
    );
    await tx(async (t) => {
      const audit = await t.select({ action: schema.auditLog.action }).from(schema.auditLog);
      expect(audit.map((a) => a.action)).toEqual(['patient_merge', 'patient_unmerge']);
      expect((await verifyAuditChain(t, tenantId)).ok).toBe(true);
    });
  });
});
