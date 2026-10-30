import 'server-only';
import { randomInt } from 'node:crypto';
import { appendAudit, recordSecurityEvent, schema, type Tx, withTenant } from '@medhub/db';
import { hashPassword } from '@medhub/db/password';
import {
  changedFields,
  roleChanges,
  type UserCreateInput,
  type UserUpdateInput,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { loadConfig, requireRecentStepUp } from './configuration';

type Client = { ip: string | null };

/**
 * Holding this permission makes a user an administrator for the last-admin
 * rule: without anyone able to manage roles, a structure could not recover.
 */
const ADMIN_PERMISSION = 'role:manage';
const TEMPORARY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export type UserView = {
  id: string;
  username: string;
  displayName: string;
  title: string | null;
  professionalNumber: string | null;
  phone: string | null;
  email: string | null;
  locale: 'fr' | 'en';
  defaultSiteId: string | null;
  defaultDepartmentId: string | null;
  status: 'active' | 'disabled' | 'locked';
  lockedUntil: string | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roleIds: string[];
  self: boolean;
};

export type UsersOverview = {
  users: UserView[];
  roles: { id: string; code: string; name: string; isPrivileged: boolean; requiresMfa: boolean }[];
  sites: { id: string; code: string; name: string; isActive: boolean }[];
  departments: { id: string; siteId: string; code: string; name: string; isActive: boolean }[];
  can: { create: boolean; update: boolean; disable: boolean; resetPassword: boolean };
};

/** Readable, single-use, at least as long as the structure's minimum. */
function temporaryPassword(minLength: number): string {
  const groups = Math.max(3, Math.ceil((minLength + 1) / 5));
  return Array.from({ length: groups }, () =>
    Array.from(
      { length: 4 },
      () => TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)] ?? 'a',
    ).join(''),
  ).join('-');
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

function activeAssignment(now: Date) {
  return or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now));
}

async function activeAdministrators(tx: Tx): Promise<number> {
  const rows = await tx
    .selectDistinct({ id: schema.userAccount.id })
    .from(schema.userAccount)
    .innerJoin(schema.userRole, eq(schema.userRole.userId, schema.userAccount.id))
    .innerJoin(schema.rolePermission, eq(schema.rolePermission.roleId, schema.userRole.roleId))
    .where(
      and(
        eq(schema.userAccount.status, 'active'),
        eq(schema.rolePermission.permissionKey, ADMIN_PERMISSION),
        activeAssignment(new Date()),
      ),
    );
  return rows.length;
}

/** Called after a change, inside its transaction: throwing undoes the change. */
export async function keepOneAdministrator(tx: Tx): Promise<void> {
  if ((await activeAdministrators(tx)) === 0) throw new AppError('USER_LAST_ADMIN', 409);
}

async function currentRoleIds(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ roleId: schema.userRole.roleId })
    .from(schema.userRole)
    .where(and(eq(schema.userRole.userId, userId), activeAssignment(new Date())));
  return [...new Set(rows.map((r) => r.roleId))];
}

async function roleCodes(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.role.id, code: schema.role.code })
    .from(schema.role)
    .where(inArray(schema.role.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** Roles, default site and department must exist in the structure (RLS hides the others). */
async function checkReferences(
  tx: Tx,
  input: Pick<UserCreateInput, 'roleIds' | 'defaultSiteId' | 'defaultDepartmentId'>,
): Promise<Map<string, string>> {
  const codes = await roleCodes(tx, input.roleIds);
  if (codes.size !== input.roleIds.length) throw new AppError('USER_ROLE_UNKNOWN', 422);
  if (input.defaultSiteId) {
    const [site] = await tx
      .select({ id: schema.site.id })
      .from(schema.site)
      .where(eq(schema.site.id, input.defaultSiteId))
      .limit(1);
    if (!site) throw new AppError('VALIDATION_FAILED', 422, { field: 'defaultSiteId' });
  }
  if (input.defaultDepartmentId) {
    const [department] = await tx
      .select({ siteId: schema.department.siteId })
      .from(schema.department)
      .where(eq(schema.department.id, input.defaultDepartmentId))
      .limit(1);
    if (!department || (input.defaultSiteId && department.siteId !== input.defaultSiteId)) {
      throw new AppError('VALIDATION_FAILED', 422, { field: 'defaultDepartmentId' });
    }
  }
  return codes;
}

async function findTarget(tx: Tx, userId: string) {
  const [user] = await tx
    .select()
    .from(schema.userAccount)
    .where(eq(schema.userAccount.id, userId))
    .limit(1);
  if (!user) throw new AppError('NOT_FOUND', 404);
  return user;
}

async function endSessions(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(schema.session)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.session.userId, userId), isNull(schema.session.revokedAt)));
}

function inTenant<T>(
  ctx: RequestContext,
  permission: string,
  fn: (tx: Tx, permissions: ReadonlySet<string>) => Promise<T>,
  options: { stepUp: boolean } = { stepUp: true },
): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, permission);
    if (options.stepUp) await requireRecentStepUp(tx, ctx);
    return fn(tx, permissions);
  });
}

export async function listUsers(ctx: RequestContext): Promise<UsersOverview> {
  return inTenant(
    ctx,
    'user:read',
    async (tx, permissions) => {
      const now = new Date();
      // One connection per transaction: the queries run one after the other.
      const users = await tx
        .select()
        .from(schema.userAccount)
        .orderBy(asc(schema.userAccount.displayName));
      const assignments = await tx
        .select({ userId: schema.userRole.userId, roleId: schema.userRole.roleId })
        .from(schema.userRole)
        .where(activeAssignment(now));
      const roles = await tx.select().from(schema.role).orderBy(asc(schema.role.name));
      const sites = await tx.select().from(schema.site).orderBy(asc(schema.site.code));
      const departments = await tx
        .select()
        .from(schema.department)
        .orderBy(asc(schema.department.name));
      const byUser = new Map<string, Set<string>>();
      for (const a of assignments) {
        const set = byUser.get(a.userId) ?? new Set<string>();
        set.add(a.roleId);
        byUser.set(a.userId, set);
      }
      return {
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          title: u.title,
          professionalNumber: u.professionalNumber,
          phone: u.phone,
          email: u.email,
          locale: u.locale === 'en' ? 'en' : 'fr',
          defaultSiteId: u.defaultSiteId,
          defaultDepartmentId: u.defaultDepartmentId,
          status: u.status as UserView['status'],
          lockedUntil: u.lockedUntil && u.lockedUntil > now ? u.lockedUntil.toISOString() : null,
          mustChangePassword: u.mustChangePassword,
          mfaEnabled: u.mfaEnabledAt !== null,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          roleIds: [...(byUser.get(u.id) ?? [])],
          self: u.id === ctx.userId,
        })),
        roles: roles.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          isPrivileged: r.isPrivileged,
          requiresMfa: r.requiresMfa,
        })),
        sites: sites.map((s) => ({ id: s.id, code: s.code, name: s.name, isActive: s.isActive })),
        departments: departments.map((d) => ({
          id: d.id,
          siteId: d.siteId,
          code: d.code,
          name: d.name,
          isActive: d.isActive,
        })),
        can: {
          create: permissions.has('user:create'),
          update: permissions.has('user:update'),
          disable: permissions.has('user:disable'),
          resetPassword: permissions.has('user:reset_password'),
        },
      };
    },
    { stepUp: false },
  );
}

/**
 * Online-only creation. The account starts with a temporary password, shown
 * once to the administrator, that the user must replace at first sign-in.
 */
export async function createUser(
  ctx: RequestContext,
  input: UserCreateInput,
  client: Client,
): Promise<{ userId: string; temporaryPassword: string }> {
  try {
    return await inTenant(ctx, 'user:create', async (tx) => {
      const codes = await checkReferences(tx, input);
      const password = temporaryPassword((await loadConfig(tx))['security.password_min_length']);
      const userId = uuidv7();
      await tx.insert(schema.userAccount).values({
        id: userId,
        tenantId: ctx.tenantId,
        username: input.username,
        displayName: input.displayName,
        title: input.title ?? null,
        professionalNumber: input.professionalNumber ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        locale: input.locale,
        defaultSiteId: input.defaultSiteId ?? null,
        defaultDepartmentId: input.defaultDepartmentId ?? null,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      });
      await tx.insert(schema.userRole).values(
        input.roleIds.map((roleId) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          userId,
          roleId,
        })),
      );
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'user_create',
        entity: 'user_account',
        entityId: userId,
        diff: { username: input.username, roles: input.roleIds.map((id) => codes.get(id)) },
      });
      return { userId, temporaryPassword: password };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('USER_USERNAME_TAKEN', 409);
    throw error;
  }
}

/** Profile and role assignments. An ended assignment keeps its history (valid_until). */
export async function updateUser(
  ctx: RequestContext,
  input: UserUpdateInput,
  client: Client,
): Promise<void> {
  await inTenant(ctx, 'user:update', async (tx) => {
    const user = await findTarget(tx, input.userId);
    const codes = await checkReferences(tx, input);
    const profile = {
      displayName: input.displayName,
      title: input.title ?? null,
      professionalNumber: input.professionalNumber ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      locale: input.locale,
      defaultSiteId: input.defaultSiteId ?? null,
      defaultDepartmentId: input.defaultDepartmentId ?? null,
    };
    const fields = changedFields(
      {
        displayName: user.displayName,
        title: user.title,
        professionalNumber: user.professionalNumber,
        phone: user.phone,
        email: user.email,
        locale: user.locale,
        defaultSiteId: user.defaultSiteId,
        defaultDepartmentId: user.defaultDepartmentId,
      } as typeof profile,
      profile,
    );
    const now = new Date();
    if (fields.length > 0) {
      await tx
        .update(schema.userAccount)
        .set({ ...profile, updatedAt: now })
        .where(eq(schema.userAccount.id, user.id));
    }
    const { added, removed } = roleChanges(await currentRoleIds(tx, user.id), input.roleIds);
    if (removed.length > 0) {
      await tx
        .update(schema.userRole)
        .set({ validUntil: now, updatedAt: now })
        .where(
          and(
            eq(schema.userRole.userId, user.id),
            inArray(schema.userRole.roleId, removed),
            activeAssignment(now),
          ),
        );
    }
    if (added.length > 0) {
      await tx.insert(schema.userRole).values(
        added.map((roleId) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          userId: user.id,
          roleId,
        })),
      );
    }
    if (removed.length > 0) await keepOneAdministrator(tx);
    if (fields.length === 0 && added.length === 0 && removed.length === 0) return;
    const removedCodes = await roleCodes(tx, removed);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'user_update',
      entity: 'user_account',
      entityId: user.id,
      diff: {
        fields,
        rolesAdded: added.map((id) => codes.get(id)),
        rolesRemoved: removed.map((id) => removedCodes.get(id)),
      },
    });
  });
}

/**
 * Disabling never deletes: sessions end at once, and each device of the user
 * learns it at its next sync (AUTH_USER_DISABLED) and drops its offline token.
 */
export async function setUserStatus(
  ctx: RequestContext,
  input: { userId: string; status: 'active' | 'disabled'; reason: string },
  client: Client,
): Promise<void> {
  if (input.userId === ctx.userId) throw new AppError('USER_IS_SELF', 409);
  await inTenant(ctx, 'user:disable', async (tx) => {
    const user = await findTarget(tx, input.userId);
    if (user.status === input.status) return;
    const now = new Date();
    await tx
      .update(schema.userAccount)
      .set(
        input.status === 'active'
          ? { status: 'active', failedLogins: 0, lockedUntil: null, updatedAt: now }
          : { status: 'disabled', updatedAt: now },
      )
      .where(eq(schema.userAccount.id, user.id));
    if (input.status === 'disabled') {
      await endSessions(tx, user.id);
      await keepOneAdministrator(tx);
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.status === 'disabled' ? 'user_disable' : 'user_enable',
      entity: 'user_account',
      entityId: user.id,
      reason: input.reason,
    });
    await recordSecurityEvent(tx, {
      kind: input.status === 'disabled' ? 'user_disabled' : 'user_enabled',
      severity: 'warning',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      ip: client.ip,
      detail: { username: user.username },
    });
  });
}

/** A new temporary password; the lockout is lifted and every session ends. */
export async function resetPassword(
  ctx: RequestContext,
  input: { userId: string },
  client: Client,
): Promise<{ temporaryPassword: string }> {
  if (input.userId === ctx.userId) throw new AppError('USER_IS_SELF', 409);
  return inTenant(ctx, 'user:reset_password', async (tx) => {
    const user = await findTarget(tx, input.userId);
    const password = temporaryPassword((await loadConfig(tx))['security.password_min_length']);
    await tx
      .update(schema.userAccount)
      .set({
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        mustChangePassword: true,
        failedLogins: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.userAccount.id, user.id));
    await endSessions(tx, user.id);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'password_reset',
      entity: 'user_account',
      entityId: user.id,
    });
    await recordSecurityEvent(tx, {
      kind: 'password_reset',
      severity: 'warning',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      ip: client.ip,
      detail: { username: user.username },
    });
    return { temporaryPassword: password };
  });
}

/**
 * Lost phone: the second factor is removed. If a role requires one, the user
 * enrolls again at the next sign-in; until then every session is ended.
 */
export async function resetMfa(
  ctx: RequestContext,
  input: { userId: string; reason: string },
  client: Client,
): Promise<void> {
  if (input.userId === ctx.userId) throw new AppError('USER_IS_SELF', 409);
  await inTenant(ctx, 'user:reset_password', async (tx) => {
    const user = await findTarget(tx, input.userId);
    if (!user.mfaEnabledAt && !user.mfaSecretEnc) throw new AppError('AUTH_MFA_NOT_ENROLLED', 409);
    await tx
      .update(schema.userAccount)
      .set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, updatedAt: new Date() })
      .where(eq(schema.userAccount.id, user.id));
    await tx.delete(schema.mfaRecoveryCode).where(eq(schema.mfaRecoveryCode.userId, user.id));
    await endSessions(tx, user.id);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'mfa_reset',
      entity: 'user_account',
      entityId: user.id,
      reason: input.reason,
    });
    await recordSecurityEvent(tx, {
      kind: 'mfa_reset',
      severity: 'warning',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      ip: client.ip,
      detail: { username: user.username },
    });
  });
}

/** Lifts a lockout after failed sign-ins without changing the password. */
export async function unlockUser(
  ctx: RequestContext,
  input: { userId: string },
  client: Client,
): Promise<void> {
  await inTenant(ctx, 'user:reset_password', async (tx) => {
    const user = await findTarget(tx, input.userId);
    await tx
      .update(schema.userAccount)
      .set({ failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(schema.userAccount.id, user.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'user_unlock',
      entity: 'user_account',
      entityId: user.id,
    });
  });
}
