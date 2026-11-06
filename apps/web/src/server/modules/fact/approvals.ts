import 'server-only';
import { appendAudit, schema, withTenant } from '@medhub/db';
import { AppError, uuidv7 } from '@medhub/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';
import { applyApproval } from '../sync';

export type ApprovalView = {
  id: string;
  kind: string;
  invoiceId: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  currency: string;
  amount: number;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  requesterId: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
};

/** Pending requests first, then the last decided ones (online screen). */
export async function listApprovals(
  ctx: RequestContext,
): Promise<{ requests: ApprovalView[]; canDecide: boolean }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    if (!permissions.has('approval:decide') && !permissions.has('invoice:discount')) {
      requirePermission(permissions, 'approval:decide');
    }
    const rows = await tx
      .select()
      .from(schema.approvalRequest)
      .orderBy(desc(schema.approvalRequest.requestedAt))
      .limit(200);
    const invoiceIds = [...new Set(rows.map((r) => r.invoiceId))];
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.createdBy, r.decidedBy]).filter((x): x is string => Boolean(x)),
      ),
    ];
    const invoices = invoiceIds.length
      ? await tx
          .select({ id: schema.invoice.id, number: schema.invoice.number })
          .from(schema.invoice)
          .where(inArray(schema.invoice.id, invoiceIds))
      : [];
    const patients = patientIds.length
      ? await tx
          .select({
            id: schema.patient.id,
            familyName: schema.patient.familyName,
            givenName: schema.patient.givenName,
            mrn: schema.patient.mrn,
          })
          .from(schema.patient)
          .where(inArray(schema.patient.id, patientIds))
      : [];
    const users = userIds.length
      ? await tx
          .select({ id: schema.userAccount.id, displayName: schema.userAccount.displayName })
          .from(schema.userAccount)
          .where(inArray(schema.userAccount.id, userIds))
      : [];
    const nameOf = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? '';
    const requests = rows
      .map((r) => {
        const p = patients.find((x) => x.id === r.patientId);
        return {
          id: r.id,
          kind: r.kind,
          invoiceId: r.invoiceId,
          invoiceNumber: invoices.find((i) => i.id === r.invoiceId)?.number ?? '',
          patientId: r.patientId,
          patientName: p ? [p.familyName, p.givenName].filter(Boolean).join(' ') || p.mrn : '',
          currency: r.currency,
          amount: r.amount,
          reason: r.reason,
          requestedAt: r.requestedAt.toISOString(),
          requestedBy: nameOf(r.createdBy),
          requesterId: r.createdBy,
          status: r.status,
          decidedBy: r.decidedBy ? nameOf(r.decidedBy) : null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          decisionReason: r.decisionReason,
        };
      })
      .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
    return { requests, canDecide: permissions.has('approval:decide') };
  });
}

/**
 * Four-eyes decision (owner decision S10): another authorised user than the
 * one who asked, with a fresh second factor. Refusing needs a reason.
 */
export async function decideApproval(
  ctx: RequestContext,
  input: { id: string; approve: boolean; reason?: string | null },
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'approval:decide');
    await requireRecentStepUp(tx, ctx);
    const [request] = await tx
      .select()
      .from(schema.approvalRequest)
      .where(eq(schema.approvalRequest.id, input.id))
      .limit(1);
    if (!request) throw new AppError('NOT_FOUND', 404);
    if (request.status !== 'pending') throw new AppError('FACT_ALREADY_DECIDED', 409);
    if (request.createdBy === ctx.userId) throw new AppError('FACT_SAME_APPROVER', 403);
    if (!input.approve && (input.reason ?? '').trim().length < 3) {
      throw new AppError('VALIDATION_FAILED', 400, { field: 'reason' });
    }
    try {
      await applyApproval(
        tx,
        { tenantId: ctx.tenantId, userId: ctx.userId, deviceId: ctx.deviceId },
        request.id,
        { approve: input.approve, deciderId: ctx.userId, reason: input.reason?.trim() || null },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'FACT_ADJUSTMENT_TOO_HIGH') {
        throw new AppError('FACT_ADJUSTMENT_TOO_HIGH', 409);
      }
      throw error;
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.approve ? 'approve' : 'reject',
      entity: 'approval_request',
      entityId: request.id,
      diff: { kind: request.kind, amount: request.amount, currency: request.currency },
    });
  });
}

/** Amount a role grants without a second person; 0 or absent means every request is decided. */
export async function saveApprovalThreshold(
  ctx: RequestContext,
  input: { roleId: string; kind: 'discount' | 'credit_note'; currency: string; maxAmount: number },
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'role:manage');
    await requireRecentStepUp(tx, ctx);
    await tx
      .insert(schema.approvalThreshold)
      .values({ id: uuidv7(), tenantId: ctx.tenantId, ...input })
      .onConflictDoUpdate({
        target: [
          schema.approvalThreshold.tenantId,
          schema.approvalThreshold.roleId,
          schema.approvalThreshold.kind,
          schema.approvalThreshold.currency,
        ],
        set: { maxAmount: input.maxAmount, updatedAt: new Date() },
      });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'update',
      entity: 'approval_threshold',
      entityId: null,
      diff: { ...input },
    });
  });
}
