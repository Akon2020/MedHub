import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  parseDrugCatalog,
  parseInteractionRules,
  type CatalogImportError,
  type DrugInfo,
  type InteractionRule,
} from '@medhub/domain';
import { AppError, parseCsv, uuidv7 } from '@medhub/shared';
import { asc, eq } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';
import { toDrugInfo } from '../sync';

export async function activeDrugs(tx: Tx): Promise<(DrugInfo & { id: string })[]> {
  const rows = await tx
    .select()
    .from(schema.drug)
    .where(eq(schema.drug.isActive, true))
    .orderBy(asc(schema.drug.inn));
  return rows.map((r) => ({ id: r.id, ...toDrugInfo(r) }));
}

export async function interactionRules(tx: Tx): Promise<InteractionRule[]> {
  const rows = await tx.select().from(schema.drugInteractionRule);
  return rows.map((r) => ({
    atcA: r.atcA,
    atcB: r.atcB,
    severity: r.severity as InteractionRule['severity'],
    message: r.message,
  }));
}

type ImportResult = { items: number; errors: CatalogImportError[]; total: number };

/**
 * Imports the drug catalogue of the structure (CSV). Without `apply` it only
 * checks; with it, rows are added or updated by code (step-up required).
 */
export async function importDrugs(
  ctx: RequestContext,
  input: { csv: string; apply: boolean },
  client: { ip: string | null },
): Promise<ImportResult> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    const { items, errors } = parseDrugCatalog(parseCsv(input.csv));
    if (input.apply) {
      await requireRecentStepUp(tx, ctx);
      if (errors.length > 0)
        throw new AppError('VALIDATION_FAILED', 400, { errors: errors.length });
      for (const item of items) {
        const values = {
          inn: item.inn,
          atcCode: item.atcCode,
          form: item.form,
          strength: item.strength,
          route: item.route,
          doseUnit: item.doseUnit,
          maxSingleDose: item.maxSingleDose,
          maxDailyDose: item.maxDailyDose,
          maxDailyDosePerKg: item.maxDailyDosePerKg,
          pregnancyCategory: item.pregnancyCategory,
          minAgeMonths: item.minAgeMonths === null ? null : Math.round(item.minAgeMonths),
          geriatricCaution: item.geriatricCaution,
          renalCaution: item.renalCaution,
          hepaticCaution: item.hepaticCaution,
          isControlled: item.isControlled,
          isActive: true,
        };
        await tx
          .insert(schema.drug)
          .values({ id: uuidv7(), tenantId: ctx.tenantId, code: item.code, ...values })
          .onConflictDoUpdate({
            target: [schema.drug.tenantId, schema.drug.code],
            set: { ...values, updatedAt: new Date() },
          });
      }
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'import',
        entity: 'drug',
        entityId: null,
        diff: { rows: items.length },
      });
    }
    return { items: items.length, errors, total: (await activeDrugs(tx)).length };
  });
}

/** Imports the interaction rules (CSV atc_a, atc_b, gravite, message). */
export async function importInteractions(
  ctx: RequestContext,
  input: { csv: string; apply: boolean },
  client: { ip: string | null },
): Promise<ImportResult> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    const { items, errors } = parseInteractionRules(parseCsv(input.csv));
    if (input.apply) {
      await requireRecentStepUp(tx, ctx);
      if (errors.length > 0)
        throw new AppError('VALIDATION_FAILED', 400, { errors: errors.length });
      for (const rule of items) {
        await tx
          .insert(schema.drugInteractionRule)
          .values({ id: uuidv7(), tenantId: ctx.tenantId, ...rule })
          .onConflictDoUpdate({
            target: [
              schema.drugInteractionRule.tenantId,
              schema.drugInteractionRule.atcA,
              schema.drugInteractionRule.atcB,
            ],
            set: { severity: rule.severity, message: rule.message, updatedAt: new Date() },
          });
      }
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'import',
        entity: 'drug_interaction_rule',
        entityId: null,
        diff: { rows: items.length },
      });
    }
    return { items: items.length, errors, total: (await interactionRules(tx)).length };
  });
}
