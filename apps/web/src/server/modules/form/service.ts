import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import { checkDefinition, formDefinition, type FormDefinition } from '@medhub/forms';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

export type FormVersionView = {
  id: string;
  version: number;
  status: string;
  publishedAt: string | null;
  definition: Record<string, unknown>;
};
export type FormView = {
  id: string;
  code: string;
  step: string;
  title: { fr: string; en?: string };
  isActive: boolean;
  versions: FormVersionView[];
};

/** Versions a workstation needs: the published ones and the archived ones (old responses). */
export async function publishedFormVersions(tx: Tx) {
  const rows = await tx
    .select()
    .from(schema.formVersion)
    .where(inArray(schema.formVersion.status, ['published', 'archived']))
    .orderBy(asc(schema.formVersion.version));
  return rows.map((r) => ({
    versionId: r.id,
    definitionId: r.formDefinitionId,
    version: r.version,
    status: r.status === 'archived' ? ('archived' as const) : ('published' as const),
    definition: r.definition,
  }));
}

export async function listForms(
  ctx: RequestContext,
): Promise<{ forms: FormView[]; canDesign: boolean; canPublish: boolean }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'form:read');
    const definitions = await tx
      .select()
      .from(schema.formDefinition)
      .orderBy(asc(schema.formDefinition.code));
    const versions = await tx
      .select()
      .from(schema.formVersion)
      .orderBy(desc(schema.formVersion.version));
    return {
      forms: definitions.map((d) => ({
        id: d.id,
        code: d.code,
        step: d.step,
        title: d.title,
        isActive: d.isActive,
        versions: versions
          .filter((v) => v.formDefinitionId === d.id)
          .map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            publishedAt: v.publishedAt?.toISOString() ?? null,
            definition: v.definition,
          })),
      })),
      canDesign: permissions.has('form:design'),
      canPublish: permissions.has('form:publish'),
    };
  });
}

function parse(definition: unknown): FormDefinition {
  const parsed = formDefinition.safeParse(definition);
  if (!parsed.success) {
    throw new AppError('FORM_INVALID', 400, {
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        path: i.path.join('.'),
        code: i.message,
      })),
    });
  }
  return parsed.data;
}

/**
 * Saves the draft of a form (created on its first save). A published version
 * is never touched: the draft is the next version number.
 */
export async function saveFormDraft(
  ctx: RequestContext,
  input: { definitionId?: string | null; definition: unknown },
  client: { ip: string | null },
): Promise<{ definitionId: string; versionId: string; version: number }> {
  const definition = parse(input.definition);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'form:design');
    const [byCode] = await tx
      .select()
      .from(schema.formDefinition)
      .where(eq(schema.formDefinition.code, definition.code))
      .limit(1);
    if (byCode && input.definitionId && byCode.id !== input.definitionId) {
      throw new AppError('FORM_CODE_TAKEN', 409);
    }
    let definitionId = input.definitionId ?? byCode?.id ?? null;
    if (definitionId) {
      const [own] = await tx
        .select()
        .from(schema.formDefinition)
        .where(eq(schema.formDefinition.id, definitionId))
        .limit(1);
      if (!own) throw new AppError('NOT_FOUND', 404);
      if (own.code !== definition.code) throw new AppError('FORM_INVALID', 400);
      await tx
        .update(schema.formDefinition)
        .set({ title: definition.title, step: definition.step, updatedAt: new Date() })
        .where(eq(schema.formDefinition.id, definitionId));
    } else {
      definitionId = uuidv7();
      await tx.insert(schema.formDefinition).values({
        id: definitionId,
        tenantId: ctx.tenantId,
        code: definition.code,
        step: definition.step,
        title: definition.title,
      });
    }
    const [draft] = await tx
      .select()
      .from(schema.formVersion)
      .where(
        and(
          eq(schema.formVersion.formDefinitionId, definitionId),
          eq(schema.formVersion.status, 'draft'),
        ),
      )
      .limit(1);
    let versionId: string;
    let version: number;
    if (draft) {
      versionId = draft.id;
      version = draft.version;
      await tx
        .update(schema.formVersion)
        .set({
          definition: definition as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(schema.formVersion.id, draft.id));
    } else {
      const [last] = await tx
        .select({ v: max(schema.formVersion.version) })
        .from(schema.formVersion)
        .where(eq(schema.formVersion.formDefinitionId, definitionId));
      versionId = uuidv7();
      version = (last?.v ?? 0) + 1;
      await tx.insert(schema.formVersion).values({
        id: versionId,
        tenantId: ctx.tenantId,
        formDefinitionId: definitionId,
        version,
        definition: definition as unknown as Record<string, unknown>,
      });
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'update',
      entity: 'form_version',
      entityId: versionId,
      diff: { code: definition.code, version, status: 'draft' },
    });
    return { definitionId, versionId, version };
  });
}

/**
 * Publishes the draft (docs/modules/form.md, règles de gestion): every
 * expression valid, no field changing type since the previous version. The
 * previous published version is archived and stays readable.
 */
export async function publishForm(
  ctx: RequestContext,
  input: { definitionId: string },
  client: { ip: string | null },
): Promise<{ versionId: string; version: number }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'form:publish');
    await requireRecentStepUp(tx, ctx);
    const versions = await tx
      .select()
      .from(schema.formVersion)
      .where(eq(schema.formVersion.formDefinitionId, input.definitionId))
      .orderBy(desc(schema.formVersion.version));
    const draft = versions.find((v) => v.status === 'draft');
    if (!draft) throw new AppError('NOT_FOUND', 404);
    const current = versions.find((v) => v.status === 'published');
    const definition = parse(draft.definition);
    const previous = current ? formDefinition.safeParse(current.definition) : null;
    const issues = checkDefinition(definition, previous?.success ? previous.data : null);
    if (issues.length > 0) throw new AppError('FORM_INVALID', 400, { issues });
    const now = new Date();
    if (current) {
      await tx
        .update(schema.formVersion)
        .set({ status: 'archived', updatedAt: now })
        .where(eq(schema.formVersion.id, current.id));
    }
    await tx
      .update(schema.formVersion)
      .set({ status: 'published', publishedAt: now, publishedBy: ctx.userId, updatedAt: now })
      .where(eq(schema.formVersion.id, draft.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'publish',
      entity: 'form_version',
      entityId: draft.id,
      diff: { code: definition.code, version: draft.version },
    });
    return { versionId: draft.id, version: draft.version };
  });
}
