import 'server-only';
import { appendAudit, schema, withSystem, withTenant, type Tx } from '@medhub/db';
import {
  canDeactivateSite,
  changedFields,
  type DepartmentCreateInput,
  type DepartmentUpdateInput,
  type SiteCreateInput,
  type SiteUpdateInput,
  type TenantProfileInput,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from './configuration';

type Client = { ip: string | null };
type SiteRow = typeof schema.site.$inferSelect;
type DepartmentRow = typeof schema.department.$inferSelect;

export type Organization = {
  tenant: {
    code: string;
    type: string;
    status: string;
    isTraining: boolean;
    displayName: string;
    legalName: string;
    defaultLocale: string;
    defaultCurrency: string;
    timezone: string;
    contact: Record<string, unknown>;
    legalMentions: string | null;
  };
  sites: Pick<SiteRow, 'id' | 'code' | 'name' | 'address' | 'timezone' | 'phone' | 'isActive'>[];
  departments: Pick<
    DepartmentRow,
    'id' | 'siteId' | 'code' | 'name' | 'kind' | 'costCenterCode' | 'isActive'
  >[];
  canEdit: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

/**
 * Configuration changes run in the structure transaction with a permission
 * check, a recent second factor and an audit entry naming the changed fields.
 */
async function withEditor<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    await requireRecentStepUp(tx, ctx);
    return fn(tx);
  });
}

export async function getOrganization(ctx: RequestContext): Promise<Organization> {
  const [tenant] = await withSystem(database().db, (tx) =>
    tx.select().from(schema.tenant).where(eq(schema.tenant.id, ctx.tenantId)).limit(1),
  );
  if (!tenant) throw new AppError('UNAUTHENTICATED', 401);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'configuration:read');
    const sites = await tx.select().from(schema.site).orderBy(schema.site.code);
    const departments = await tx.select().from(schema.department).orderBy(schema.department.code);
    return {
      tenant: {
        code: tenant.code,
        type: tenant.type,
        status: tenant.status,
        isTraining: tenant.isTraining,
        displayName: tenant.displayName,
        legalName: tenant.legalName,
        defaultLocale: tenant.defaultLocale,
        defaultCurrency: tenant.defaultCurrency,
        timezone: tenant.timezone,
        contact: tenant.contact,
        legalMentions: tenant.legalMentions,
      },
      sites: sites.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        address: s.address,
        timezone: s.timezone,
        phone: s.phone,
        isActive: s.isActive,
      })),
      departments: departments.map((d) => ({
        id: d.id,
        siteId: d.siteId,
        code: d.code,
        name: d.name,
        kind: d.kind,
        costCenterCode: d.costCenterCode,
        isActive: d.isActive,
      })),
      canEdit: permissions.has('configuration:edit'),
    };
  });
}

/**
 * The structure row is a platform table: it is only ever updated through this
 * function, filtered by the structure of the session.
 */
export async function updateTenantProfile(
  ctx: RequestContext,
  input: TenantProfileInput,
  client: Client,
): Promise<void> {
  await withEditor(ctx, async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.id, ctx.tenantId))
      .limit(1);
    if (!before) throw new AppError('NOT_FOUND', 404);
    const patch = {
      displayName: input.displayName,
      legalName: input.legalName,
      defaultLocale: input.defaultLocale,
      defaultCurrency: input.defaultCurrency,
      timezone: input.timezone,
      contact: input.contact as Record<string, unknown>,
      legalMentions: input.legalMentions ?? null,
    };
    const fields = changedFields(before, patch);
    if (fields.length === 0) return;
    await tx
      .update(schema.tenant)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.tenant.id, ctx.tenantId));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'update',
      entity: 'tenant',
      entityId: ctx.tenantId,
      diff: { fields },
    });
  });
}

export async function createSite(
  ctx: RequestContext,
  input: SiteCreateInput,
  client: Client,
): Promise<{ id: string }> {
  const id = uuidv7();
  try {
    await withEditor(ctx, async (tx) => {
      await tx.insert(schema.site).values({
        id,
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        address: input.address as Record<string, unknown>,
        timezone: input.timezone,
        phone: input.phone ?? null,
      });
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'create',
        entity: 'site',
        entityId: id,
        diff: { code: input.code },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('ORG_SITE_CODE_TAKEN', 409);
    throw error;
  }
  return { id };
}

/** Sites are deactivated, never deleted; their code is immutable (document numbers). */
export async function updateSite(
  ctx: RequestContext,
  input: SiteUpdateInput,
  client: Client,
): Promise<void> {
  await withEditor(ctx, async (tx) => {
    const sites = await tx.select().from(schema.site);
    const before = sites.find((s) => s.id === input.id);
    if (!before) throw new AppError('NOT_FOUND', 404);
    if (input.isActive === false && before.isActive && !canDeactivateSite(sites, before.id)) {
      throw new AppError('ORG_LAST_ACTIVE_SITE', 409);
    }
    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address as Record<string, unknown> } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const fields = changedFields(before, patch);
    if (fields.length === 0) return;
    await tx
      .update(schema.site)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.site.id, before.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.isActive === false ? 'deactivate' : 'update',
      entity: 'site',
      entityId: before.id,
      diff: { fields },
    });
  });
}

export async function createDepartment(
  ctx: RequestContext,
  input: DepartmentCreateInput,
  client: Client,
): Promise<{ id: string }> {
  const id = uuidv7();
  try {
    await withEditor(ctx, async (tx) => {
      const [site] = await tx
        .select()
        .from(schema.site)
        .where(eq(schema.site.id, input.siteId))
        .limit(1);
      if (!site) throw new AppError('NOT_FOUND', 404);
      if (!site.isActive) throw new AppError('ORG_SITE_INACTIVE', 409);
      await tx.insert(schema.department).values({
        id,
        tenantId: ctx.tenantId,
        siteId: site.id,
        code: input.code,
        name: input.name,
        kind: input.kind,
        costCenterCode: input.costCenterCode ?? null,
      });
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'create',
        entity: 'department',
        entityId: id,
        diff: { code: input.code, siteId: site.id },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('ORG_DEPARTMENT_CODE_TAKEN', 409);
    throw error;
  }
  return { id };
}

export async function updateDepartment(
  ctx: RequestContext,
  input: DepartmentUpdateInput,
  client: Client,
): Promise<void> {
  await withEditor(ctx, async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.department)
      .where(eq(schema.department.id, input.id))
      .limit(1);
    if (!before) throw new AppError('NOT_FOUND', 404);
    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.costCenterCode !== undefined ? { costCenterCode: input.costCenterCode } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const fields = changedFields(before, patch);
    if (fields.length === 0) return;
    await tx
      .update(schema.department)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.department.id, before.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.isActive === false ? 'deactivate' : 'update',
      entity: 'department',
      entityId: before.id,
      diff: { fields },
    });
  });
}

export type SecurityEventView = {
  id: string;
  at: string;
  kind: string;
  severity: string;
  user: string | null;
  ip: string | null;
  detail: Record<string, unknown>;
};

/**
 * Security events concerning the structure of the session (unusual sign-ins,
 * refused addresses, second factor changes), for its administrators.
 */
export async function listSecurityEvents(
  ctx: RequestContext,
  limit = 100,
): Promise<SecurityEventView[]> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) =>
    requirePermission(await loadPermissions(tx, ctx.userId), 'audit:review'),
  );
  const events = await withSystem(database().db, (tx) =>
    tx
      .select()
      .from(schema.securityEvent)
      .where(eq(schema.securityEvent.targetTenantId, ctx.tenantId))
      .orderBy(desc(schema.securityEvent.at))
      .limit(limit),
  );
  const userIds = [...new Set(events.map((e) => e.userId).filter((id): id is string => !!id))];
  const users =
    userIds.length === 0
      ? []
      : await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
          tx
            .select({ id: schema.userAccount.id, displayName: schema.userAccount.displayName })
            .from(schema.userAccount)
            .where(inArray(schema.userAccount.id, userIds)),
        );
  const byId = new Map(users.map((u) => [u.id, u.displayName]));
  return events.map((e) => ({
    id: e.id,
    at: e.at.toISOString(),
    kind: e.kind,
    severity: e.severity,
    user: e.userId ? (byId.get(e.userId) ?? null) : null,
    ip: e.ip,
    detail: e.detail,
  }));
}
