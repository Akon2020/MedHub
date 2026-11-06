import 'server-only';
import { appendAudit, schema, withTenant } from '@medhub/db';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import { requireRecordAccess } from '../dpi';
import type { RequestContext } from '../../platform/tenant';
import { updateServerPatient } from '../sync';

export type FieldChange = {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  source: string;
  changedAt: string;
  changedBy: string | null;
  device: string | null;
};

export type PatientConflict = {
  id: string;
  patientId: string;
  patient: string;
  mrn: string;
  serverValue: Record<string, unknown>;
  clientValue: Record<string, unknown>;
  device: string | null;
  createdAt: string;
};

const HISTORY_LIMIT = 300;

/**
 * Field-by-field history of a patient's civil status. Reading it is a read of
 * the record: it is written to the access log (CLAUDE.md, rule 10).
 */
export async function patientHistory(
  ctx: RequestContext,
  patientId: string,
): Promise<{ changes: FieldChange[] }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:read');
    const [patient] = await tx
      .select({ id: schema.patient.id, sensitivity: schema.patient.sensitivity })
      .from(schema.patient)
      .where(eq(schema.patient.id, patientId))
      .limit(1);
    if (!patient) throw new AppError('NOT_FOUND', 404);
    await requireRecordAccess(tx, ctx.userId, patientId, patient.sensitivity);
    await tx.insert(schema.dataAccessLog).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      patientId,
      screen: 'patient_history',
    });
    const rows = await tx
      .select({
        change: schema.patientFieldHistory,
        user: schema.userAccount.displayName,
        device: schema.device.deviceCode,
      })
      .from(schema.patientFieldHistory)
      .leftJoin(schema.userAccount, eq(schema.userAccount.id, schema.patientFieldHistory.changedBy))
      .leftJoin(schema.device, eq(schema.device.id, schema.patientFieldHistory.deviceId))
      .where(eq(schema.patientFieldHistory.patientId, patientId))
      .orderBy(desc(schema.patientFieldHistory.changedAt))
      .limit(HISTORY_LIMIT);
    return {
      changes: rows.map(({ change, user, device }) => ({
        id: change.id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        source: change.source,
        changedAt: change.changedAt.toISOString(),
        changedBy: user,
        device,
      })),
    };
  });
}

/**
 * Stale writes on sensitive fields (birth date, sex, family name) kept the
 * server value and opened a conflict (docs/02-offline-sync.md): the
 * administrator reviews them here.
 */
export async function listPatientConflicts(
  ctx: RequestContext,
): Promise<{ conflicts: PatientConflict[] }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:merge');
    const conflicts = await tx
      .select({ conflict: schema.syncConflict, device: schema.device.deviceCode })
      .from(schema.syncConflict)
      .leftJoin(schema.opLog, eq(schema.opLog.opId, schema.syncConflict.opId))
      .leftJoin(schema.device, eq(schema.device.id, schema.opLog.deviceId))
      .where(and(eq(schema.syncConflict.entity, 'patient'), eq(schema.syncConflict.status, 'open')))
      .orderBy(desc(schema.syncConflict.createdAt))
      .limit(200);
    const ids = [...new Set(conflicts.map((c) => c.conflict.entityId))];
    const patients =
      ids.length === 0
        ? []
        : await tx.select().from(schema.patient).where(inArray(schema.patient.id, ids));
    const byId = new Map(patients.map((p) => [p.id, p]));
    return {
      conflicts: conflicts.map(({ conflict, device }) => {
        const p = byId.get(conflict.entityId);
        return {
          id: conflict.id,
          patientId: conflict.entityId,
          patient: p ? [p.familyName, p.middleName, p.givenName].filter(Boolean).join(' ') : '',
          mrn: p?.mrn ?? '',
          serverValue: (conflict.serverValue ?? {}) as Record<string, unknown>,
          clientValue: (conflict.clientValue ?? {}) as Record<string, unknown>,
          device,
          createdAt: conflict.createdAt.toISOString(),
        };
      }),
    };
  });
}

/** Keep the value in force, or apply the one the device sent: both are traced. */
export async function resolvePatientConflict(
  ctx: RequestContext,
  input: { conflictId: string; choice: 'keep' | 'apply'; reason: string },
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:merge');
    const [conflict] = await tx
      .select()
      .from(schema.syncConflict)
      .where(
        and(eq(schema.syncConflict.id, input.conflictId), eq(schema.syncConflict.status, 'open')),
      )
      .limit(1);
    if (!conflict || conflict.entity !== 'patient') throw new AppError('NOT_FOUND', 404);
    if (input.choice === 'apply') {
      await updateServerPatient(
        tx,
        { tenantId: ctx.tenantId, userId: ctx.userId },
        conflict.entityId,
        (conflict.clientValue ?? {}) as Record<string, unknown>,
        'review',
      );
    }
    const now = new Date();
    await tx
      .update(schema.syncConflict)
      .set({
        status: input.choice === 'apply' ? 'resolved' : 'dismissed',
        resolvedBy: ctx.userId,
        resolvedAt: now,
      })
      .where(eq(schema.syncConflict.id, conflict.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.choice === 'apply' ? 'conflict_apply' : 'conflict_keep',
      entity: 'patient',
      entityId: conflict.entityId,
      patientId: conflict.entityId,
      reason: input.reason,
      diff: { conflictId: conflict.id, fields: Object.keys(conflict.clientValue ?? {}) },
    });
  });
}
