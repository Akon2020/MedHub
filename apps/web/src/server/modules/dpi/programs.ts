import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  changedFields,
  followUpStatus,
  patientFullName,
  sensitivityAllowed,
  type ProgramInput,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, loadSensitivityMax, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

type ProgramRow = typeof schema.program.$inferSelect;

export async function activePrograms(tx: Tx): Promise<ProgramRow[]> {
  return tx
    .select()
    .from(schema.program)
    .where(eq(schema.program.isActive, true))
    .orderBy(asc(schema.program.name));
}

export async function listPrograms(
  ctx: RequestContext,
): Promise<{ programs: ProgramRow[]; canEdit: boolean }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'configuration:read');
    return {
      programs: await tx.select().from(schema.program).orderBy(asc(schema.program.name)),
      canEdit: permissions.has('configuration:edit'),
    };
  });
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

export async function saveProgram(
  ctx: RequestContext,
  input: ProgramInput,
  client: { ip: string | null },
): Promise<{ id: string }> {
  try {
    return await withTenant(
      database().db,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      async (tx) => {
        requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
        await requireRecentStepUp(tx, ctx);
        const values = {
          code: input.code,
          name: input.name,
          followUpIntervalDays: input.followUpIntervalDays,
          graceDays: input.graceDays,
          isActive: input.isActive,
        };
        let id = input.id ?? null;
        let fields: string[] = Object.keys(values);
        if (id) {
          const [before] = await tx.select().from(schema.program).where(eq(schema.program.id, id));
          if (!before) throw new AppError('NOT_FOUND', 404);
          fields = changedFields(before, values);
          if (fields.length === 0) return { id };
          await tx
            .update(schema.program)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(schema.program.id, id));
        } else {
          id = uuidv7();
          await tx.insert(schema.program).values({ id, tenantId: ctx.tenantId, ...values });
        }
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          ip: client.ip,
          action: input.id ? 'update' : 'create',
          entity: 'program',
          entityId: id,
          diff: { fields },
        });
        return { id };
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('RDV_CODE_TAKEN', 409);
    throw error;
  }
}

export type FollowUpRow = {
  enrollmentId: string;
  patientId: string;
  mrn: string;
  name: string;
  phone: string | null;
  program: string;
  lastContact: string | null;
  dueAt: string;
  lost: boolean;
  daysLate: number;
};

const FOLLOW_UP_LIMIT = 500;

/**
 * Patients of the active programmes with their last contact (visit, vital
 * sign, triage), next expected date and lost-to-follow-up flag: the call list
 * of the team. Names of records above the user's level stay masked.
 */
export async function followUpList(ctx: RequestContext): Promise<{ rows: FollowUpRow[] }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'clinical_record:read');
    const level = await loadSensitivityMax(tx, ctx.userId);
    const programs = await activePrograms(tx);
    if (programs.length === 0) return { rows: [] };
    const enrollments = await tx
      .select({ enrollment: schema.programEnrollment, patient: schema.patient })
      .from(schema.programEnrollment)
      .innerJoin(schema.patient, eq(schema.patient.id, schema.programEnrollment.patientId))
      .where(
        and(
          eq(schema.programEnrollment.status, 'active'),
          inArray(
            schema.programEnrollment.programId,
            programs.map((p) => p.id),
          ),
        ),
      )
      .limit(FOLLOW_UP_LIMIT);
    const ids = [...new Set(enrollments.map((e) => e.patient.id))];
    const latest = new Map<string, Date>();
    const keep = (rows: { patientId: string; at: Date | null }[]) => {
      for (const r of rows) {
        if (r.at && r.at > (latest.get(r.patientId) ?? new Date(0))) latest.set(r.patientId, r.at);
      }
    };
    if (ids.length > 0) {
      keep(
        await tx
          .select({ patientId: schema.encounter.patientId, at: max(schema.encounter.startedAt) })
          .from(schema.encounter)
          .where(inArray(schema.encounter.patientId, ids))
          .groupBy(schema.encounter.patientId),
      );
      keep(
        await tx
          .select({ patientId: schema.vitalSign.patientId, at: max(schema.vitalSign.measuredAt) })
          .from(schema.vitalSign)
          .where(inArray(schema.vitalSign.patientId, ids))
          .groupBy(schema.vitalSign.patientId),
      );
      keep(
        await tx
          .select({ patientId: schema.triage.patientId, at: max(schema.triage.triagedAt) })
          .from(schema.triage)
          .where(inArray(schema.triage.patientId, ids))
          .groupBy(schema.triage.patientId),
      );
    }
    const now = new Date();
    const rows = enrollments.map(({ enrollment, patient }) => {
      const p = programs.find((x) => x.id === enrollment.programId);
      const status = followUpStatus({
        enrolledAt: enrollment.enrolledAt.toISOString(),
        lastContact: latest.get(patient.id)?.toISOString() ?? null,
        intervalDays: p?.followUpIntervalDays ?? 30,
        graceDays: p?.graceDays ?? 14,
        now,
      });
      const visible = sensitivityAllowed(patient.sensitivity, level);
      return {
        enrollmentId: enrollment.id,
        patientId: patient.id,
        mrn: patient.mrn,
        name: visible ? patientFullName(patient) : '',
        phone: visible ? patient.phone : null,
        program: p?.name ?? '',
        lastContact: latest.get(patient.id)?.toISOString() ?? null,
        ...status,
      };
    });
    rows.sort((a, b) => Number(b.lost) - Number(a.lost) || b.daysLate - a.daysLate);
    return { rows };
  });
}
