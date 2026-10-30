import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  CONFIG_DEFINITIONS,
  CONFIG_KEYS,
  resolveConfig,
  type ConfigKey,
  type ConfigValues,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, desc, eq, max } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';

/** Published values of the structure, defaults for the keys it never changed. */
export async function loadConfig(tx: Tx): Promise<ConfigValues> {
  const rows = await tx
    .select({ key: schema.configEntry.key, value: schema.configEntry.value })
    .from(schema.configEntry)
    .where(eq(schema.configEntry.status, 'published'));
  return resolveConfig(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/**
 * Sensitive changes require a second factor proven within the window the
 * structure configured (docs/modules/core.md: the 2FA of their author).
 */
export function requireStepUp(ctx: RequestContext, windowMinutes: number, now = Date.now()): void {
  if (!ctx.mfaVerifiedAt || now - ctx.mfaVerifiedAt.getTime() > windowMinutes * 60_000) {
    throw new AppError('AUTH_STEP_UP_REQUIRED', 403);
  }
}

export async function requireRecentStepUp(tx: Tx, ctx: RequestContext): Promise<void> {
  requireStepUp(ctx, (await loadConfig(tx))['security.step_up_minutes']);
}

type Version = {
  version: number;
  status: string;
  value: unknown;
  note: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type ConfigItem = {
  key: ConfigKey;
  domain: string;
  unit: string;
  default: unknown;
  published: Version | null;
  draft: Version | null;
  history: Version[];
};

function view(row: typeof schema.configEntry.$inferSelect): Version {
  return {
    version: row.version,
    status: row.status,
    value: row.value,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export async function getConfiguration(
  ctx: RequestContext,
): Promise<{ items: ConfigItem[]; canEdit: boolean; canPublish: boolean }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'configuration:read');
    const rows = await tx
      .select()
      .from(schema.configEntry)
      .orderBy(desc(schema.configEntry.version));
    const items = CONFIG_KEYS.map((key) => {
      const versions = rows.filter((r) => r.key === key);
      const definition = CONFIG_DEFINITIONS[key];
      const published = versions.find((r) => r.status === 'published');
      const draft = versions.find((r) => r.status === 'draft');
      return {
        key,
        domain: definition.domain,
        unit: definition.unit,
        default: definition.default,
        published: published ? view(published) : null,
        draft: draft ? view(draft) : null,
        history: versions
          .filter((r) => r.status !== 'draft')
          .slice(0, 10)
          .map(view),
      };
    });
    return {
      items,
      canEdit: permissions.has('configuration:edit'),
      canPublish: permissions.has('configuration:publish'),
    };
  });
}

async function withEditor<T>(
  ctx: RequestContext,
  permission: 'configuration:edit' | 'configuration:publish',
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), permission);
    await requireRecentStepUp(tx, ctx);
    return fn(tx);
  });
}

async function nextVersion(tx: Tx, key: ConfigKey): Promise<number> {
  const [row] = await tx
    .select({ last: max(schema.configEntry.version) })
    .from(schema.configEntry)
    .where(eq(schema.configEntry.key, key));
  return (row?.last ?? 0) + 1;
}

/** Creates or replaces the single draft of a key. */
export async function saveDraft(
  ctx: RequestContext,
  input: { key: ConfigKey; value: unknown; note?: string | null },
): Promise<void> {
  const parsed = CONFIG_DEFINITIONS[input.key].schema.safeParse(input.value);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED', 400, { key: input.key });
  await withEditor(ctx, 'configuration:edit', async (tx) => {
    const [draft] = await tx
      .select()
      .from(schema.configEntry)
      .where(and(eq(schema.configEntry.key, input.key), eq(schema.configEntry.status, 'draft')))
      .limit(1);
    if (draft) {
      await tx
        .update(schema.configEntry)
        .set({ value: parsed.data, note: input.note ?? null, updatedAt: new Date() })
        .where(eq(schema.configEntry.id, draft.id));
      return;
    }
    await tx.insert(schema.configEntry).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      domain: CONFIG_DEFINITIONS[input.key].domain,
      key: input.key,
      version: await nextVersion(tx, input.key),
      status: 'draft',
      value: parsed.data,
      note: input.note ?? null,
      createdBy: ctx.userId,
    });
  });
}

export async function discardDraft(ctx: RequestContext, key: ConfigKey): Promise<void> {
  await withEditor(ctx, 'configuration:edit', (tx) =>
    tx
      .delete(schema.configEntry)
      .where(and(eq(schema.configEntry.key, key), eq(schema.configEntry.status, 'draft'))),
  );
}

/** The draft becomes the published version; the previous one is archived. */
export async function publishDraft(
  ctx: RequestContext,
  key: ConfigKey,
  client: { ip: string | null },
): Promise<void> {
  await withEditor(ctx, 'configuration:publish', async (tx) => {
    const [draft] = await tx
      .select()
      .from(schema.configEntry)
      .where(and(eq(schema.configEntry.key, key), eq(schema.configEntry.status, 'draft')))
      .limit(1);
    if (!draft) throw new AppError('NOT_FOUND', 404);
    const [previous] = await tx
      .update(schema.configEntry)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(schema.configEntry.key, key), eq(schema.configEntry.status, 'published')))
      .returning({ version: schema.configEntry.version, value: schema.configEntry.value });
    const now = new Date();
    await tx
      .update(schema.configEntry)
      .set({
        status: 'published',
        publishedAt: now,
        publishedBy: ctx.userId,
        effectiveFrom: now,
        updatedAt: now,
      })
      .where(eq(schema.configEntry.id, draft.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'config_publish',
      entity: 'config_entry',
      entityId: draft.id,
      diff: {
        key,
        version: draft.version,
        from: previous?.value ?? CONFIG_DEFINITIONS[key].default,
        to: draft.value,
      },
    });
  });
}

/** Reverting never rewrites history: the old value becomes a new draft to publish. */
export async function restoreVersion(
  ctx: RequestContext,
  key: ConfigKey,
  version: number,
): Promise<void> {
  const value = await withTenant(
    database().db,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    async (tx) => {
      const [row] = await tx
        .select({ value: schema.configEntry.value })
        .from(schema.configEntry)
        .where(and(eq(schema.configEntry.key, key), eq(schema.configEntry.version, version)))
        .limit(1);
      return row?.value;
    },
  );
  if (value === undefined) throw new AppError('NOT_FOUND', 404);
  await saveDraft(ctx, { key, value, note: `restore:${version}` });
}
