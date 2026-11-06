import 'server-only';
import { planRules, type PlanRules } from '@medhub/conventions';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  diffBeneficiaries,
  parseBeneficiaries,
  type BeneficiaryImportError,
  type BeneficiaryRow,
  type ContractInput,
  type PayerInput,
} from '@medhub/domain';
import { AppError, parseCsv, uuidv7 } from '@medhub/shared';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

type Client = { ip: string | null };

const run = <T>(ctx: RequestContext, fn: (tx: Tx, permissions: Set<string>) => Promise<T>) =>
  withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) =>
    fn(tx, await loadPermissions(tx, ctx.userId)),
  );

const audit = (
  tx: Tx,
  ctx: RequestContext,
  client: Client,
  action: string,
  entity: string,
  entityId: string | null,
  diff: Record<string, unknown>,
) =>
  appendAudit(tx, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    ip: client.ip,
    action,
    entity,
    entityId,
    diff,
  });

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

/**
 * What the workstations need to apply the contracts offline: active
 * contracts, the published plan of each code and the beneficiaries in force.
 */
export async function conventionsCatalog(tx: Tx) {
  const contracts = await tx
    .select()
    .from(schema.contract)
    .where(eq(schema.contract.status, 'active'));
  const ids = contracts.map((c) => c.id);
  if (ids.length === 0) return { contracts: [], plans: [], beneficiaries: [] };
  const payers = await tx.select().from(schema.payer);
  const plans = await tx
    .select()
    .from(schema.contractPlan)
    .where(
      and(
        inArray(schema.contractPlan.contractId, ids),
        eq(schema.contractPlan.status, 'published'),
      ),
    );
  const beneficiaries = await tx
    .select()
    .from(schema.beneficiary)
    .where(inArray(schema.beneficiary.contractId, ids));
  return {
    contracts: contracts.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      payerName: payers.find((p) => p.id === c.payerId)?.name ?? '',
      currency: c.currency,
      priceListId: c.priceListId,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
    })),
    plans: plans.map((p) => ({
      id: p.id,
      contractId: p.contractId,
      code: p.code,
      version: p.version,
      rules: p.rules,
    })),
    beneficiaries: beneficiaries
      .filter((b) => b.status !== 'left')
      .map((b) => ({
        id: b.id,
        contractId: b.contractId,
        planCode: b.planCode,
        memberNumber: b.memberNumber,
        familyNumber: b.familyNumber,
        fullName: b.fullName,
        role: b.role,
        validFrom: b.validFrom,
        validUntil: b.validUntil,
        status: b.status,
        isDayLaborer: b.isDayLaborer,
      })),
  };
}

export async function conventionsOverview(ctx: RequestContext) {
  return run(ctx, async (tx, permissions) => {
    requirePermission(permissions, 'contract:read');
    const payers = await tx.select().from(schema.payer).orderBy(asc(schema.payer.name));
    const contracts = await tx.select().from(schema.contract).orderBy(asc(schema.contract.code));
    const plans = await tx
      .select()
      .from(schema.contractPlan)
      .orderBy(asc(schema.contractPlan.code), desc(schema.contractPlan.version));
    const counts = await tx
      .select({ contractId: schema.beneficiary.contractId, status: schema.beneficiary.status })
      .from(schema.beneficiary);
    return {
      payers,
      contracts: contracts.map((c) => ({
        ...c,
        beneficiaries: counts.filter((b) => b.contractId === c.id && b.status !== 'left').length,
      })),
      plans,
      permissions: {
        create: permissions.has('contract:create'),
        update: permissions.has('contract:update'),
        activate: permissions.has('contract:activate'),
        import: permissions.has('beneficiary:import'),
      },
    };
  });
}

export async function savePayer(ctx: RequestContext, input: PayerInput, client: Client) {
  try {
    return await run(ctx, async (tx, permissions) => {
      requirePermission(permissions, input.id ? 'contract:update' : 'contract:create');
      const values = {
        code: input.code,
        name: input.name,
        kind: input.kind,
        contact: input.contact as Record<string, unknown>,
        paymentTermDays: input.paymentTermDays,
        isActive: input.isActive,
      };
      const id = input.id ?? uuidv7();
      if (input.id) {
        await tx
          .update(schema.payer)
          .set({ ...values, code: undefined, updatedAt: new Date() })
          .where(eq(schema.payer.id, input.id));
      } else {
        await tx.insert(schema.payer).values({ id, tenantId: ctx.tenantId, ...values });
      }
      await audit(tx, ctx, client, 'update', 'payer', id, { code: input.code, name: input.name });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('CONV_CODE_TAKEN', 409);
    throw error;
  }
}

export async function saveContract(ctx: RequestContext, input: ContractInput, client: Client) {
  try {
    return await run(ctx, async (tx, permissions) => {
      requirePermission(permissions, input.id ? 'contract:update' : 'contract:create');
      const values = {
        payerId: input.payerId,
        name: input.name,
        currency: input.currency,
        validFrom: input.validFrom,
        validUntil: input.validUntil ?? null,
        invoiceDay: input.invoiceDay,
        priceListId: input.priceListId ?? null,
      };
      const id = input.id ?? uuidv7();
      if (input.id) {
        await tx
          .update(schema.contract)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.contract.id, input.id));
      } else {
        await tx
          .insert(schema.contract)
          .values({ id, tenantId: ctx.tenantId, code: input.code, ...values });
      }
      await audit(tx, ctx, client, 'update', 'contract', id, { code: input.code });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('CONV_CODE_TAKEN', 409);
    throw error;
  }
}

/** Activation needs at least one published plan; termination is final. */
export async function setContractStatus(
  ctx: RequestContext,
  input: { id: string; status: 'active' | 'suspended' | 'terminated' },
  client: Client,
) {
  return run(ctx, async (tx, permissions) => {
    requirePermission(permissions, 'contract:activate');
    await requireRecentStepUp(tx, ctx);
    const [current] = await tx
      .select()
      .from(schema.contract)
      .where(eq(schema.contract.id, input.id));
    if (!current) throw new AppError('NOT_FOUND', 404);
    if (current.status === 'terminated') throw new AppError('CONV_CONTRACT_NOT_ACTIVE', 409);
    if (input.status === 'active') {
      const [published] = await tx
        .select({ id: schema.contractPlan.id })
        .from(schema.contractPlan)
        .where(
          and(
            eq(schema.contractPlan.contractId, input.id),
            eq(schema.contractPlan.status, 'published'),
          ),
        )
        .limit(1);
      if (!published) throw new AppError('CONV_PLAN_INVALID', 409);
    }
    await tx
      .update(schema.contract)
      .set({
        status: input.status,
        terminatedAt: input.status === 'terminated' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.contract.id, input.id));
    await audit(tx, ctx, client, 'update', 'contract', input.id, { status: input.status });
  });
}

function parsePlan(rules: unknown): PlanRules {
  const parsed = planRules.safeParse(rules);
  if (!parsed.success) {
    throw new AppError('CONV_PLAN_INVALID', 400, {
      issues: parsed.error.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.join('.'), code: i.message })),
    });
  }
  return parsed.data;
}

/** Saves the draft of a plan; a published version never changes (rules are versioned). */
export async function savePlanDraft(
  ctx: RequestContext,
  input: { contractId: string; rules: unknown },
  client: Client,
) {
  const rules = parsePlan(input.rules);
  return run(ctx, async (tx, permissions) => {
    requirePermission(permissions, 'contract:update');
    const [draft] = await tx
      .select()
      .from(schema.contractPlan)
      .where(
        and(
          eq(schema.contractPlan.contractId, input.contractId),
          eq(schema.contractPlan.code, rules.code),
          eq(schema.contractPlan.status, 'draft'),
        ),
      )
      .limit(1);
    let id = draft?.id;
    let version = draft?.version ?? 0;
    if (draft) {
      await tx
        .update(schema.contractPlan)
        .set({ rules: rules as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(schema.contractPlan.id, draft.id));
    } else {
      const [last] = await tx
        .select({ v: max(schema.contractPlan.version) })
        .from(schema.contractPlan)
        .where(
          and(
            eq(schema.contractPlan.contractId, input.contractId),
            eq(schema.contractPlan.code, rules.code),
          ),
        );
      id = uuidv7();
      version = (last?.v ?? 0) + 1;
      await tx.insert(schema.contractPlan).values({
        id,
        tenantId: ctx.tenantId,
        contractId: input.contractId,
        code: rules.code,
        version,
        rules: rules as unknown as Record<string, unknown>,
      });
    }
    await audit(tx, ctx, client, 'update', 'contract_plan', id ?? null, {
      code: rules.code,
      version,
    });
    return { id: id as string, version };
  });
}

export async function publishPlan(
  ctx: RequestContext,
  input: { contractId: string; code: string },
  client: Client,
) {
  return run(ctx, async (tx, permissions) => {
    requirePermission(permissions, 'contract:activate');
    await requireRecentStepUp(tx, ctx);
    const versions = await tx
      .select()
      .from(schema.contractPlan)
      .where(
        and(
          eq(schema.contractPlan.contractId, input.contractId),
          eq(schema.contractPlan.code, input.code),
        ),
      );
    const draft = versions.find((v) => v.status === 'draft');
    if (!draft) throw new AppError('NOT_FOUND', 404);
    parsePlan(draft.rules);
    const now = new Date();
    for (const v of versions.filter((x) => x.status === 'published')) {
      await tx
        .update(schema.contractPlan)
        .set({ status: 'archived', updatedAt: now })
        .where(eq(schema.contractPlan.id, v.id));
    }
    await tx
      .update(schema.contractPlan)
      .set({ status: 'published', publishedAt: now, publishedBy: ctx.userId, updatedAt: now })
      .where(eq(schema.contractPlan.id, draft.id));
    await audit(tx, ctx, client, 'publish', 'contract_plan', draft.id, {
      code: input.code,
      version: draft.version,
    });
    return { version: draft.version };
  });
}

export async function listBeneficiaries(ctx: RequestContext, contractId: string) {
  return run(ctx, async (tx, permissions) => {
    requirePermission(permissions, 'beneficiary:read');
    return tx
      .select()
      .from(schema.beneficiary)
      .where(eq(schema.beneficiary.contractId, contractId))
      .orderBy(asc(schema.beneficiary.familyNumber), asc(schema.beneficiary.memberNumber));
  });
}

type ImportReport = {
  errors: BeneficiaryImportError[];
  entries: number;
  changes: number;
  exits: number;
  total: number;
};

/**
 * Payer's list of workers and dependants (docs/modules/conv.md 5): checked,
 * compared with the list held (report of differences), then applied with a
 * movement for every entry, change and exit. Nothing is deleted.
 */
export async function importBeneficiaries(
  ctx: RequestContext,
  input: {
    contractId: string;
    csv: string;
    apply: boolean;
    completeList: boolean;
    effectiveOn: string;
  },
  client: Client,
): Promise<ImportReport> {
  return run(ctx, async (tx, permissions) => {
    requirePermission(permissions, 'beneficiary:import');
    const plans = await tx
      .select({ code: schema.contractPlan.code })
      .from(schema.contractPlan)
      .where(eq(schema.contractPlan.contractId, input.contractId));
    const { items, errors } = parseBeneficiaries(parseCsv(input.csv), [
      ...new Set(plans.map((p) => p.code)),
    ]);
    const existingRows = await tx
      .select()
      .from(schema.beneficiary)
      .where(eq(schema.beneficiary.contractId, input.contractId));
    const existing = existingRows.map((b) => ({
      id: b.id,
      status: b.status,
      memberNumber: b.memberNumber,
      familyNumber: b.familyNumber,
      fullName: b.fullName,
      role: b.role as BeneficiaryRow['role'],
      planCode: b.planCode,
      birthDate: b.birthDate,
      validFrom: b.validFrom,
      validUntil: b.validUntil,
      isDayLaborer: b.isDayLaborer,
    }));
    const diff = diffBeneficiaries(existing, items, { completeList: input.completeList });
    const report = {
      errors,
      entries: diff.entries.length,
      changes: diff.changes.length,
      exits: diff.exits.length,
      total: existing.filter((e) => e.status !== 'left').length,
    };
    if (!input.apply) return report;
    if (errors.length > 0) throw new AppError('VALIDATION_FAILED', 400, { errors: errors.length });
    const movement = (
      beneficiaryId: string,
      kind: 'entry' | 'change' | 'exit',
      detail: Record<string, unknown>,
    ) =>
      tx.insert(schema.beneficiaryMovement).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        beneficiaryId,
        kind,
        effectiveOn: input.effectiveOn,
        source: 'import',
        detail,
      });
    for (const row of diff.entries) {
      const before = existing.find((e) => e.memberNumber === row.memberNumber);
      const id = before?.id ?? uuidv7();
      if (before) {
        await tx
          .update(schema.beneficiary)
          .set({ ...row, status: 'active', updatedAt: new Date() })
          .where(eq(schema.beneficiary.id, id));
      } else {
        await tx
          .insert(schema.beneficiary)
          .values({ id, tenantId: ctx.tenantId, contractId: input.contractId, ...row });
      }
      await movement(id, 'entry', { memberNumber: row.memberNumber });
    }
    for (const change of diff.changes) {
      await tx
        .update(schema.beneficiary)
        .set({ ...change.after, updatedAt: new Date() })
        .where(eq(schema.beneficiary.id, change.id));
      await movement(change.id, 'change', { fields: change.fields });
    }
    for (const exit of diff.exits) {
      await tx
        .update(schema.beneficiary)
        .set({ status: 'left', validUntil: input.effectiveOn, updatedAt: new Date() })
        .where(eq(schema.beneficiary.id, exit.id));
      await movement(exit.id, 'exit', { memberNumber: exit.memberNumber });
    }
    await audit(tx, ctx, client, 'import', 'beneficiary', null, {
      contractId: input.contractId,
      entries: report.entries,
      changes: report.changes,
      exits: report.exits,
    });
    return { ...report, total: report.total + report.entries - report.exits };
  });
}
