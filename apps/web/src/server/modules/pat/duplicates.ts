import 'server-only';
import { appendAudit, schema, withTenant } from '@medhub/db';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';

export type DuplicatePatient = {
  id: string;
  mrn: string;
  familyName: string;
  middleName: string | null;
  givenName: string | null;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
  createdAt: string;
};

export type DuplicatePair = {
  id: string;
  score: number;
  reasons: string[];
  createdAt: string;
  a: DuplicatePatient;
  b: DuplicatePatient;
};

const QUEUE_LIMIT = 200;

function view(p: typeof schema.patient.$inferSelect): DuplicatePatient {
  return {
    id: p.id,
    mrn: p.mrn,
    familyName: p.familyName,
    middleName: p.middleName,
    givenName: p.givenName,
    sex: p.sex,
    birthDate: p.birthDate,
    birthDateEstimated: p.birthDateEstimated,
    phone: p.phone,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Open pairs, highest score first: the queue an authorised user reviews (scenario P3). */
export async function listDuplicates(ctx: RequestContext): Promise<{ pairs: DuplicatePair[] }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:merge');
    const pairs = await tx
      .select()
      .from(schema.duplicateCandidate)
      .where(eq(schema.duplicateCandidate.status, 'open'))
      .orderBy(desc(schema.duplicateCandidate.score), desc(schema.duplicateCandidate.createdAt))
      .limit(QUEUE_LIMIT);
    const ids = [...new Set(pairs.flatMap((p) => [p.patientAId, p.patientBId]))];
    const patients =
      ids.length === 0
        ? []
        : await tx.select().from(schema.patient).where(inArray(schema.patient.id, ids));
    const byId = new Map(patients.map((p) => [p.id, view(p)]));
    return {
      pairs: pairs.flatMap((p) => {
        const a = byId.get(p.patientAId);
        const b = byId.get(p.patientBId);
        return a && b
          ? [
              {
                id: p.id,
                score: p.score,
                reasons: p.reasons,
                createdAt: p.createdAt.toISOString(),
                a,
                b,
              },
            ]
          : [];
      }),
    };
  });
}

/** "Not the same person": the pair leaves the queue, the decision stays on record. */
export async function dismissDuplicate(
  ctx: RequestContext,
  input: { candidateId: string; reason: string },
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:merge');
    const now = new Date();
    const updated = await tx
      .update(schema.duplicateCandidate)
      .set({
        status: 'dismissed',
        decidedBy: ctx.userId,
        decidedAt: now,
        decisionReason: input.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.duplicateCandidate.id, input.candidateId),
          eq(schema.duplicateCandidate.status, 'open'),
        ),
      )
      .returning({ id: schema.duplicateCandidate.id });
    if (updated.length === 0) throw new AppError('NOT_FOUND', 404);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'duplicate_dismissed',
      entity: 'duplicate_candidate',
      entityId: input.candidateId,
      reason: input.reason,
    });
  });
}

/**
 * A user recognises two records as the same person, typically a provisional
 * record and the patient's known one: the pair goes to the queue, where a
 * user allowed to merge decides (the merge itself stays supervised).
 */
export async function reportDuplicate(
  ctx: RequestContext,
  input: { patientId: string; otherId: string },
  client: { ip: string | null },
): Promise<{ candidateId: string }> {
  if (input.patientId === input.otherId) throw new AppError('VALIDATION_FAILED', 400);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:update');
    const found = await tx
      .select({ id: schema.patient.id, mergedIntoId: schema.patient.mergedIntoId })
      .from(schema.patient)
      .where(inArray(schema.patient.id, [input.patientId, input.otherId]));
    if (found.length !== 2) throw new AppError('PAT_NOT_FOUND', 404);
    if (found.some((p) => p.mergedIntoId)) throw new AppError('PAT_ALREADY_MERGED', 409);
    const [a, b] =
      input.patientId < input.otherId
        ? [input.patientId, input.otherId]
        : [input.otherId, input.patientId];
    const now = new Date();
    const [row] = await tx
      .insert(schema.duplicateCandidate)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        patientAId: a,
        patientBId: b,
        score: 100,
        reasons: ['manual'],
      })
      .onConflictDoUpdate({
        target: [
          schema.duplicateCandidate.tenantId,
          schema.duplicateCandidate.patientAId,
          schema.duplicateCandidate.patientBId,
        ],
        set: { status: 'open', score: 100, reasons: ['manual'], updatedAt: now },
        setWhere: ne(schema.duplicateCandidate.status, 'merged'),
      })
      .returning({ id: schema.duplicateCandidate.id });
    if (!row) throw new AppError('PAT_ALREADY_MERGED', 409);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'duplicate_reported',
      entity: 'duplicate_candidate',
      entityId: row.id,
      patientId: input.patientId,
    });
    return { candidateId: row.id };
  });
}
