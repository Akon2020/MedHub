import 'server-only';
import { appendAudit, schema, withTenant } from '@medhub/db';
import { AppError } from '@medhub/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
