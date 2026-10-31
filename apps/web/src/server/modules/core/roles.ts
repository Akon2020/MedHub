import 'server-only';
import { appendAudit, recordSecurityEvent, schema, type Tx, withTenant } from '@medhub/db';
import {
  changedFields,
  grantChanges,
  isPrivilegedRole,
  type RoleCreateInput,
  type RoleGrant,
  type RoleUpdateInput,
} from '@medhub/domain';
import { AppError, PRIVILEGED_PERMISSIONS, uuidv7, type PermissionScope } from '@medhub/shared';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from './configuration';
import { keepOneAdministrator } from './users';

type Client = { ip: string | null };

export type RoleView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPrivileged: boolean;
  requiresMfa: boolean;
  templateCode: string | null;
  version: number;
  members: number;
  grants: RoleGrant[];
};

export type RolesOverview = { roles: RoleView[]; canManage: boolean };

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

async function grantsOf(tx: Tx, roleId: string): Promise<RoleGrant[]> {
  const rows = await tx
    .select({ key: schema.rolePermission.permissionKey, scope: schema.rolePermission.scope })
    .from(schema.rolePermission)
    .where(eq(schema.rolePermission.roleId, roleId))
    .orderBy(asc(schema.rolePermission.permissionKey));
  return rows.map((r) => ({ key: r.key, scope: r.scope as PermissionScope }));
}

async function writeGrants(
  tx: Tx,
  tenantId: string,
  roleId: string,
  grants: readonly RoleGrant[],
): Promise<void> {
  // Configuration rows: the audit trail keeps every change (added, removed, rescoped).
  await tx.delete(schema.rolePermission).where(eq(schema.rolePermission.roleId, roleId));
  if (grants.length === 0) return;
  await tx
    .insert(schema.rolePermission)
    .values(grants.map((g) => ({ tenantId, roleId, permissionKey: g.key, scope: g.scope })));
}

async function manage<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'role:manage');
    await requireRecentStepUp(tx, ctx);
    return fn(tx);
  });
}

export async function listRoles(ctx: RequestContext): Promise<RolesOverview> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'role:read');
    const now = new Date();
    const roles = await tx.select().from(schema.role).orderBy(asc(schema.role.name));
    const grants = await tx
      .select({
        roleId: schema.rolePermission.roleId,
        key: schema.rolePermission.permissionKey,
        scope: schema.rolePermission.scope,
      })
      .from(schema.rolePermission)
      .orderBy(asc(schema.rolePermission.permissionKey));
    const members = await tx
      .selectDistinct({ roleId: schema.userRole.roleId, userId: schema.userRole.userId })
      .from(schema.userRole)
      .innerJoin(schema.userAccount, eq(schema.userAccount.id, schema.userRole.userId))
      .where(
        and(
          eq(schema.userAccount.status, 'active'),
          or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now)),
        ),
      );
    return {
      canManage: permissions.has('role:manage'),
      roles: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isPrivileged: r.isPrivileged,
        requiresMfa: r.requiresMfa,
        templateCode: r.templateCode,
        version: r.version,
        members: members.filter((m) => m.roleId === r.id).length,
        grants: grants
          .filter((g) => g.roleId === r.id)
          .map((g) => ({ key: g.key, scope: g.scope as PermissionScope })),
      })),
    };
  });
}

/** New role, empty or duplicated from another one (a template copy, for example). */
export async function createRole(
  ctx: RequestContext,
  input: RoleCreateInput,
  client: Client,
): Promise<{ roleId: string }> {
  try {
    return await manage(ctx, async (tx) => {
      let grants: RoleGrant[] = [];
      if (input.copyFromRoleId) {
        const [source] = await tx
          .select({ id: schema.role.id })
          .from(schema.role)
          .where(eq(schema.role.id, input.copyFromRoleId))
          .limit(1);
        if (!source) throw new AppError('NOT_FOUND', 404);
        grants = await grantsOf(tx, source.id);
      }
      const privileged = isPrivilegedRole(
        null,
        grants.map((g) => g.key),
      );
      const roleId = uuidv7();
      await tx.insert(schema.role).values({
        id: roleId,
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isPrivileged: privileged,
        requiresMfa: privileged || input.requiresMfa,
      });
      await writeGrants(tx, ctx.tenantId, roleId, grants);
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'role_create',
        entity: 'role',
        entityId: roleId,
        diff: {
          code: input.code,
          copiedFrom: input.copyFromRoleId ?? null,
          permissions: grants.length,
        },
      });
      return { roleId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('ROLE_CODE_TAKEN', 409);
    throw error;
  }
}

/**
 * Replaces the name, the second-factor flag and the whole permission grid of a
 * role. Users holding it get the new permissions at their next request, and
 * each device at its next sync. A change that would leave the structure
 * without an administrator is undone.
 */
export async function updateRole(
  ctx: RequestContext,
  input: RoleUpdateInput,
  client: Client,
): Promise<void> {
  await manage(ctx, async (tx) => {
    const [role] = await tx
      .select()
      .from(schema.role)
      .where(eq(schema.role.id, input.roleId))
      .limit(1);
    if (!role) throw new AppError('NOT_FOUND', 404);
    const before = await grantsOf(tx, role.id);
    const changes = grantChanges(before, input.grants);
    const privileged = isPrivilegedRole(
      role.templateCode,
      input.grants.map((g) => g.key),
    );
    const fields = {
      name: input.name,
      description: input.description ?? null,
      requiresMfa: privileged || input.requiresMfa,
      isPrivileged: privileged,
    };
    const changedProfile = changedFields(
      {
        name: role.name,
        description: role.description,
        requiresMfa: role.requiresMfa,
        isPrivileged: role.isPrivileged,
      } as typeof fields,
      fields,
    );
    const grantsChanged =
      changes.added.length + changes.removed.length + changes.rescoped.length > 0;
    if (!grantsChanged && changedProfile.length === 0) return;

    await tx
      .update(schema.role)
      .set({ ...fields, version: role.version + 1, updatedAt: new Date() })
      .where(eq(schema.role.id, role.id));
    if (grantsChanged) await writeGrants(tx, ctx.tenantId, role.id, input.grants);
    if (changes.removed.length > 0) await keepOneAdministrator(tx);

    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'role_update',
      entity: 'role',
      entityId: role.id,
      diff: { fields: changedProfile, ...changes, version: role.version + 1 },
    });
    const sensitive = [...changes.added, ...changes.removed].filter((k) =>
      PRIVILEGED_PERMISSIONS.has(k),
    );
    if (sensitive.length > 0) {
      await recordSecurityEvent(tx, {
        kind: 'role_privileges_changed',
        severity: 'warning',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        ip: client.ip,
        detail: { role: role.code, permissions: sensitive },
      });
    }
  });
}
