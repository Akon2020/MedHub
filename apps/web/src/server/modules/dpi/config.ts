import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  DEFAULT_VITAL_SIGN_DEFINITIONS,
  type NormalRange,
  type VitalDefinitionInput,
} from '@medhub/domain';
import { uuidv7, type VitalSignCode } from '@medhub/shared';
import { eq } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

export type VitalDefinitionView = {
  code: VitalSignCode;
  unit: string;
  plausibleMin: number;
  plausibleMax: number;
  stabilityMargin: number | null;
  normalRanges: NormalRange[];
  /** True when the structure has its own row for this code. */
  configured: boolean;
};

/** Built-in plausibility bounds completed by the structure's own settings. */
export async function effectiveVitalDefinitions(tx: Tx): Promise<VitalDefinitionView[]> {
  const rows = await tx.select().from(schema.vitalSignDefinition);
  return DEFAULT_VITAL_SIGN_DEFINITIONS.map((d) => {
    const row = rows.find((r) => r.code === d.code);
    return {
      code: d.code,
      unit: d.unit,
      plausibleMin: row?.plausibleMin ?? d.plausibleMin,
      plausibleMax: row?.plausibleMax ?? d.plausibleMax,
      stabilityMargin: row?.stabilityMargin ?? null,
      normalRanges: (row?.normalRanges ?? []) as NormalRange[],
      configured: Boolean(row),
    };
  });
}

export async function getVitalDefinitions(
  ctx: RequestContext,
): Promise<{ definitions: VitalDefinitionView[]; canEdit: boolean }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'configuration:read');
    return {
      definitions: await effectiveVitalDefinitions(tx),
      canEdit: permissions.has('configuration:edit'),
    };
  });
}

export async function saveVitalDefinition(
  ctx: RequestContext,
  input: VitalDefinitionInput,
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    await requireRecentStepUp(tx, ctx);
    const values = {
      plausibleMin: input.plausibleMin,
      plausibleMax: input.plausibleMax,
      stabilityMargin: input.stabilityMargin ?? null,
      normalRanges: input.normalRanges as unknown as Record<string, unknown>[],
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    const [before] = await tx
      .select()
      .from(schema.vitalSignDefinition)
      .where(eq(schema.vitalSignDefinition.code, input.code));
    if (before) {
      await tx
        .update(schema.vitalSignDefinition)
        .set(values)
        .where(eq(schema.vitalSignDefinition.id, before.id));
    } else {
      await tx
        .insert(schema.vitalSignDefinition)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, code: input.code, ...values });
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'config_publish',
      entity: 'vital_sign_definition',
      entityId: before?.id ?? null,
      diff: {
        code: input.code,
        plausible: [input.plausibleMin, input.plausibleMax],
        ranges: input.normalRanges.length,
      },
    });
  });
}
