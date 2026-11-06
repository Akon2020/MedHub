import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import { sensitivityAllowed, type BREAK_GLASS_OUTCOMES } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { and, desc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, loadSensitivityMax, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';

/** An emergency access of the user to the patient still running now. */
export async function hasActiveBreakGlass(
  tx: Tx,
  userId: string,
  patientId: string,
): Promise<boolean> {
  const now = new Date();
  const rows = await tx
    .select({ id: schema.breakGlassEvent.id })
    .from(schema.breakGlassEvent)
    .where(
      and(
        eq(schema.breakGlassEvent.userId, userId),
        eq(schema.breakGlassEvent.patientId, patientId),
        lte(schema.breakGlassEvent.startedAt, new Date(now.getTime() + 60_000)),
        gt(schema.breakGlassEvent.endsAt, now),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * A record above the user's level opens only through a running emergency
 * access (the device sends it before asking for the record).
 */
export async function requireRecordAccess(
  tx: Tx,
  userId: string,
  patientId: string,
  sensitivity: unknown,
): Promise<void> {
  if (sensitivityAllowed(sensitivity, await loadSensitivityMax(tx, userId))) return;
  if (await hasActiveBreakGlass(tx, userId, patientId)) return;
  throw new AppError('PAT_SENSITIVE', 403);
}

export type BreakGlassReviewRow = {
  id: string;
  user: string;
  patientMrn: string;
  reasonCode: string;
  reasonText: string;
  startedAt: string;
  endsAt: string;
  reviewedAt: string | null;
  reviewOutcome: string | null;
  reviewComment: string | null;
};

const REVIEW_LIMIT = 200;

/** Review board: emergency accesses, those still to review first (audit:review). */
export async function listBreakGlass(
  ctx: RequestContext,
): Promise<{ events: BreakGlassReviewRow[] }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'audit:review');
    const rows = await tx
      .select({
        event: schema.breakGlassEvent,
        user: schema.userAccount.displayName,
        mrn: schema.patient.mrn,
      })
      .from(schema.breakGlassEvent)
      .leftJoin(schema.userAccount, eq(schema.userAccount.id, schema.breakGlassEvent.userId))
      .leftJoin(schema.patient, eq(schema.patient.id, schema.breakGlassEvent.patientId))
      .orderBy(desc(schema.breakGlassEvent.startedAt))
      .limit(REVIEW_LIMIT);
    const events = rows.map((r) => ({
      id: r.event.id,
      user: r.user ?? '',
      patientMrn: r.mrn ?? '',
      reasonCode: r.event.reasonCode,
      reasonText: r.event.reasonText,
      startedAt: r.event.startedAt.toISOString(),
      endsAt: r.event.endsAt.toISOString(),
      reviewedAt: r.event.reviewedAt?.toISOString() ?? null,
      reviewOutcome: r.event.reviewOutcome,
      reviewComment: r.event.reviewComment,
    }));
    return {
      events: [...events.filter((e) => !e.reviewedAt), ...events.filter((e) => e.reviewedAt)],
    };
  });
}

/** The review is recorded once; the access itself is never changed. */
export async function reviewBreakGlass(
  ctx: RequestContext,
  input: {
    breakGlassId: string;
    outcome: (typeof BREAK_GLASS_OUTCOMES)[number];
    comment?: string | null;
  },
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'audit:review');
    const updated = await tx
      .update(schema.breakGlassEvent)
      .set({
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        reviewOutcome: input.outcome,
        reviewComment: input.comment ?? null,
      })
      .where(
        and(
          eq(schema.breakGlassEvent.id, input.breakGlassId),
          isNull(schema.breakGlassEvent.reviewedAt),
        ),
      )
      .returning({ patientId: schema.breakGlassEvent.patientId });
    if (updated.length === 0) throw new AppError('NOT_FOUND', 404);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'break_glass_review',
      entity: 'break_glass_event',
      entityId: input.breakGlassId,
      patientId: updated[0]?.patientId ?? null,
      diff: { outcome: input.outcome },
    });
  });
}

export type AccessEntry = {
  at: string;
  user: string;
  device: string | null;
  screen: string;
  emergency: boolean;
};

/** Who opened the record, when and from which workstation (audit:read). */
export async function patientAccessLog(
  ctx: RequestContext,
  patientId: string,
): Promise<{ entries: AccessEntry[] }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'audit:read');
    const rows = await tx
      .select({
        at: schema.dataAccessLog.at,
        userId: schema.dataAccessLog.userId,
        user: schema.userAccount.displayName,
        device: schema.device.deviceCode,
        screen: schema.dataAccessLog.screen,
      })
      .from(schema.dataAccessLog)
      .leftJoin(schema.userAccount, eq(schema.userAccount.id, schema.dataAccessLog.userId))
      .leftJoin(schema.device, eq(schema.device.id, schema.dataAccessLog.deviceId))
      .where(eq(schema.dataAccessLog.patientId, patientId))
      .orderBy(desc(schema.dataAccessLog.at))
      .limit(REVIEW_LIMIT);
    const users = [...new Set(rows.map((r) => r.userId))];
    const grants =
      users.length === 0
        ? []
        : await tx
            .select()
            .from(schema.breakGlassEvent)
            .where(
              and(
                eq(schema.breakGlassEvent.patientId, patientId),
                inArray(schema.breakGlassEvent.userId, users),
              ),
            );
    return {
      entries: rows.map((r) => ({
        at: r.at.toISOString(),
        user: r.user ?? '',
        device: r.device,
        screen: r.screen,
        emergency: grants.some(
          (g) => g.userId === r.userId && g.startedAt <= r.at && g.endsAt > r.at,
        ),
      })),
    };
  });
}
