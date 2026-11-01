import 'server-only';
import { appendAudit, schema, type Tx, withTenant } from '@medhub/db';
import {
  mergePatch,
  unmergePatch,
  type Demographics,
  type DemographicsPatch,
  type PatientMergeInput,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, desc, eq, or } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { updateServerPatient } from '../sync';

type Client = { ip: string | null };
type PatientRow = typeof schema.patient.$inferSelect;

export type MergeView = {
  id: string;
  status: 'active' | 'undone';
  survivor: { id: string; name: string; mrn: string };
  merged: { id: string; name: string; mrn: string };
  fields: string[];
  reason: string;
  createdAt: string;
  undoneAt: string | null;
};

function demographics(p: PatientRow): Demographics {
  return {
    familyName: p.familyName,
    middleName: p.middleName,
    givenName: p.givenName,
    sex: p.sex,
    birthDate: p.birthDate,
    birthDateEstimated: p.birthDateEstimated,
    phone: p.phone,
  };
}

async function findPatient(tx: Tx, id: string): Promise<PatientRow> {
  const [row] = await tx.select().from(schema.patient).where(eq(schema.patient.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 404);
  return row;
}

function inTenant<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:merge');
    return fn(tx);
  });
}

/**
 * Supervised merge (docs/modules/pat.md): the survivor takes the values chosen
 * from the other record, the merged record only points to the survivor. No
 * clinical, financial or appointment row is rewritten; timelines follow the
 * pointer. Both changes reach the devices with their next pull.
 */
export async function mergePatients(
  ctx: RequestContext,
  input: PatientMergeInput,
  client: Client,
): Promise<{ mergeId: string }> {
  return inTenant(ctx, async (tx) => {
    const survivor = await findPatient(tx, input.survivorId);
    const merged = await findPatient(tx, input.mergedId);
    if (survivor.mergedIntoId || merged.mergedIntoId) {
      throw new AppError('PAT_ALREADY_MERGED', 409);
    }
    const patch = mergePatch(demographics(survivor), demographics(merged), input.keep);
    const who = { tenantId: ctx.tenantId, userId: ctx.userId };
    if (Object.keys(patch).length > 0) await updateServerPatient(tx, who, survivor.id, patch);
    await updateServerPatient(tx, who, merged.id, { mergedIntoId: survivor.id });

    const mergeId = uuidv7();
    await tx.insert(schema.patientMerge).values({
      id: mergeId,
      tenantId: ctx.tenantId,
      survivorId: survivor.id,
      mergedId: merged.id,
      candidateId: input.candidateId ?? null,
      keep: input.keep as Record<string, string>,
      survivorBefore: demographics(survivor),
      mergedBefore: demographics(merged),
      appliedPatch: patch,
      reason: input.reason,
      mergedBy: ctx.userId,
    });
    const [a, b] = survivor.id < merged.id ? [survivor.id, merged.id] : [merged.id, survivor.id];
    const now = new Date();
    await tx
      .update(schema.duplicateCandidate)
      .set({ status: 'merged', decidedBy: ctx.userId, decidedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.duplicateCandidate.status, 'open'),
          or(
            input.candidateId ? eq(schema.duplicateCandidate.id, input.candidateId) : undefined,
            and(
              eq(schema.duplicateCandidate.patientAId, a),
              eq(schema.duplicateCandidate.patientBId, b),
            ),
          ),
        ),
      );
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'patient_merge',
      entity: 'patient',
      entityId: merged.id,
      patientId: survivor.id,
      reason: input.reason,
      diff: { mergeId, survivorId: survivor.id, fields: Object.keys(patch) },
    });
    return { mergeId };
  });
}

/**
 * Undoing restores the separation: the merged record stands alone again and
 * the survivor gets back its previous values, except those changed since.
 */
export async function unmergePatients(
  ctx: RequestContext,
  input: { mergeId: string; reason: string },
  client: Client,
): Promise<{ kept: string[] }> {
  return inTenant(ctx, async (tx) => {
    const [merge] = await tx
      .select()
      .from(schema.patientMerge)
      .where(eq(schema.patientMerge.id, input.mergeId))
      .limit(1);
    if (!merge) throw new AppError('NOT_FOUND', 404);
    if (merge.status !== 'active') throw new AppError('PAT_MERGE_UNDONE', 409);
    const survivor = await findPatient(tx, merge.survivorId);
    const { patch, kept } = unmergePatch(
      merge.survivorBefore as Demographics,
      merge.appliedPatch as DemographicsPatch,
      demographics(survivor),
    );
    const who = { tenantId: ctx.tenantId, userId: ctx.userId };
    if (Object.keys(patch).length > 0) await updateServerPatient(tx, who, survivor.id, patch);
    await updateServerPatient(tx, who, merge.mergedId, { mergedIntoId: null });
    const now = new Date();
    await tx
      .update(schema.patientMerge)
      .set({
        status: 'undone',
        undoneBy: ctx.userId,
        undoneAt: now,
        undoReason: input.reason,
        updatedAt: now,
      })
      .where(eq(schema.patientMerge.id, merge.id));
    // The pair goes back to the queue: the reviewers decide again.
    const [a, b] =
      merge.survivorId < merge.mergedId
        ? [merge.survivorId, merge.mergedId]
        : [merge.mergedId, merge.survivorId];
    await tx
      .update(schema.duplicateCandidate)
      .set({ status: 'open', decidedBy: null, decidedAt: null, updatedAt: now })
      .where(
        and(
          eq(schema.duplicateCandidate.status, 'merged'),
          eq(schema.duplicateCandidate.patientAId, a),
          eq(schema.duplicateCandidate.patientBId, b),
        ),
      );
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'patient_unmerge',
      entity: 'patient',
      entityId: merge.mergedId,
      patientId: merge.survivorId,
      reason: input.reason,
      diff: { mergeId: merge.id, restored: Object.keys(patch), kept },
    });
    return { kept };
  });
}

const nameOf = (d: Record<string, unknown>) =>
  [d.familyName, d.middleName, d.givenName].filter((v) => typeof v === 'string' && v).join(' ');

/** Recent merges, to review them and undo one if needed. */
export async function listMerges(ctx: RequestContext): Promise<{ merges: MergeView[] }> {
  return inTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        merge: schema.patientMerge,
        survivorMrn: schema.patient.mrn,
      })
      .from(schema.patientMerge)
      .leftJoin(schema.patient, eq(schema.patient.id, schema.patientMerge.survivorId))
      .orderBy(desc(schema.patientMerge.createdAt))
      .limit(50);
    const mergedMrns = new Map<string, string>();
    for (const { merge } of rows) {
      const [m] = await tx
        .select({ mrn: schema.patient.mrn })
        .from(schema.patient)
        .where(eq(schema.patient.id, merge.mergedId))
        .limit(1);
      if (m) mergedMrns.set(merge.mergedId, m.mrn);
    }
    return {
      merges: rows.map(({ merge, survivorMrn }) => ({
        id: merge.id,
        status: merge.status === 'undone' ? 'undone' : 'active',
        survivor: {
          id: merge.survivorId,
          name: nameOf(merge.survivorBefore),
          mrn: survivorMrn ?? '',
        },
        merged: {
          id: merge.mergedId,
          name: nameOf(merge.mergedBefore),
          mrn: mergedMrns.get(merge.mergedId) ?? '',
        },
        fields: Object.keys(merge.appliedPatch).sort(),
        reason: merge.reason,
        createdAt: merge.createdAt.toISOString(),
        undoneAt: merge.undoneAt?.toISOString() ?? null,
      })),
    };
  });
}
