import 'server-only';
import { appendAudit, schema, withTenant } from '@medhub/db';
import { guaranteeBalance } from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

type Client = { ip: string | null };

/** Requests of prior authorization, pending first (online queue of Direction). */
export async function listPriorAuthorizations(ctx: RequestContext) {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'prior_authorization:read');
    const rows = await tx
      .select()
      .from(schema.priorAuthorization)
      .orderBy(desc(schema.priorAuthorization.requestedAt))
      .limit(200);
    const contracts = rows.length
      ? await tx
          .select({ id: schema.contract.id, name: schema.contract.name })
          .from(schema.contract)
          .where(inArray(schema.contract.id, [...new Set(rows.map((r) => r.contractId))]))
      : [];
    const members = rows.length
      ? await tx
          .select({
            id: schema.beneficiary.id,
            fullName: schema.beneficiary.fullName,
            memberNumber: schema.beneficiary.memberNumber,
          })
          .from(schema.beneficiary)
          .where(inArray(schema.beneficiary.id, [...new Set(rows.map((r) => r.beneficiaryId))]))
      : [];
    return {
      requests: rows
        .map((r) => ({
          ...r,
          contractName: contracts.find((c) => c.id === r.contractId)?.name ?? '',
          memberName: members.find((m) => m.id === r.beneficiaryId)?.fullName ?? '',
          memberNumber: members.find((m) => m.id === r.beneficiaryId)?.memberNumber ?? '',
        }))
        .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)),
      canDecide: permissions.has('prior_authorization:decide'),
    };
  });
}

/**
 * Records the payer's decision (docs/modules/conv.md, P4 step 4): approved
 * for an amount and until a day, or rejected with a note. The decision then
 * reaches the cash desk with the next synchronisation.
 */
export async function decidePriorAuthorization(
  ctx: RequestContext,
  input: {
    id: string;
    approve: boolean;
    authorizedAmount?: number | null;
    validUntil?: string | null;
    payerReference?: string | null;
    note?: string | null;
  },
  client: Client,
) {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'prior_authorization:decide');
    await requireRecentStepUp(tx, ctx);
    const [request] = await tx
      .select()
      .from(schema.priorAuthorization)
      .where(eq(schema.priorAuthorization.id, input.id))
      .limit(1);
    if (!request) throw new AppError('NOT_FOUND', 404);
    if (request.status !== 'pending') throw new AppError('FACT_ALREADY_DECIDED', 409);
    const now = new Date();
    const version = request.version + 1;
    const opId = uuidv7();
    await tx
      .update(schema.priorAuthorization)
      .set({
        status: input.approve ? 'approved' : 'rejected',
        authorizedAmount: input.approve ? (input.authorizedAmount ?? null) : null,
        validUntil: input.approve ? (input.validUntil ?? null) : null,
        payerReference: input.payerReference ?? null,
        decisionNote: input.note ?? null,
        decidedBy: ctx.userId,
        decidedAt: now,
        version,
        opId,
        updatedAt: now,
        updatedBy: ctx.userId,
      })
      .where(eq(schema.priorAuthorization.id, request.id));
    await tx.insert(schema.changeLog).values({
      tenantId: ctx.tenantId,
      entity: 'prior_authorization',
      entityId: request.id,
      version,
      opId,
      scopeKeys: [`patient:${request.patientId}`],
    });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.approve ? 'approve' : 'reject',
      entity: 'prior_authorization',
      entityId: request.id,
      diff: {
        authorizedAmount: input.authorizedAmount ?? null,
        validUntil: input.validUntil ?? null,
      },
    });
  });
}

export async function listGuarantees(ctx: RequestContext, contractId: string) {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'contract:read');
    const rows = await tx
      .select()
      .from(schema.guarantee)
      .where(eq(schema.guarantee.contractId, contractId))
      .orderBy(desc(schema.guarantee.recordedAt));
    return { rows, balance: guaranteeBalance(rows) };
  });
}

/**
 * Guarantee per worker (docs/modules/conv.md 5): received when the contract
 * starts, refunded at termination; never more refunded than held.
 */
export async function recordGuarantee(
  ctx: RequestContext,
  input: {
    contractId: string;
    memberNumber?: string | null;
    kind: 'receive' | 'refund';
    amount: number;
    currency: string;
    method: string;
    reference?: string | null;
  },
  client: Client,
) {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'payer_invoice:record_payment');
    await requireRecentStepUp(tx, ctx);
    const rows = await tx
      .select()
      .from(schema.guarantee)
      .where(eq(schema.guarantee.contractId, input.contractId));
    const balance = guaranteeBalance(rows);
    const held = input.memberNumber ? (balance.byMember[input.memberNumber] ?? 0) : balance.total;
    if (input.kind === 'refund' && input.amount > held)
      throw new AppError('CONV_GUARANTEE_TOO_HIGH', 409);
    const id = uuidv7();
    await tx.insert(schema.guarantee).values({
      id,
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      contractId: input.contractId,
      memberNumber: input.memberNumber ?? null,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      reference: input.reference ?? null,
      recordedAt: new Date(),
    });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.kind === 'refund' ? 'refund' : 'receive',
      entity: 'guarantee',
      entityId: id,
      diff: {
        amount: input.amount,
        currency: input.currency,
        memberNumber: input.memberNumber ?? null,
      },
    });
    return { id };
  });
}
