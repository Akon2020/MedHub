import 'server-only';
import { appendAudit, schema, verifyPassword, withSystem, withTenant, type Tx } from '@medhub/db';
import { AppError, normalizeTenantCode, uuidv7, type DeviceKind } from '@medhub/shared';
import { and, eq } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import { createSession } from '../../platform/session';
import type { RequestContext } from '../../platform/tenant';

const LOCKOUT_STEPS: { failures: number; minutes: number }[] = [
  { failures: 20, minutes: 60 * 24 * 365 },
  { failures: 10, minutes: 15 },
  { failures: 5, minutes: 1 },
];
const SUSPENDED_STATES = new Set(['suspended', 'terminated', 'archived']);
const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export type Profile = {
  user: { id: string; displayName: string; title: string | null; username: string };
  tenant: { id: string; code: string; displayName: string; isTraining: boolean; status: string };
  site: { id: string; code: string } | null;
  permissions: string[];
};

async function siteOf(tx: Tx, siteId: string | null): Promise<{ id: string; code: string } | null> {
  if (!siteId) return null;
  const [row] = await tx
    .select({ id: schema.site.id, code: schema.site.code })
    .from(schema.site)
    .where(eq(schema.site.id, siteId))
    .limit(1);
  return row ?? null;
}

async function findTenantByCode(code: string) {
  const [row] = await withSystem(database().db, (tx) =>
    tx
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.code, normalizeTenantCode(code)))
      .limit(1),
  );
  return row ?? null;
}

/**
 * Online sign-in: structure code, username and password. Progressive lockout
 * per account; the same error for unknown user and wrong password.
 */
export async function login(input: {
  tenantCode: string;
  username: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ profile: Profile; cookie: string; expiresAt: Date }> {
  const tenant = await findTenantByCode(input.tenantCode);
  if (!tenant) throw new AppError('AUTH_TENANT_UNKNOWN', 404);
  if (SUSPENDED_STATES.has(tenant.status)) throw new AppError('AUTH_TENANT_SUSPENDED', 403);

  const db = database().db;
  // Failures are returned, not thrown, so that the lockout counter and the audit
  // entry are committed with the transaction.
  const outcome = await withTenant(db, { tenantId: tenant.id, userId: null }, async (tx) => {
    const [user] = await tx
      .select()
      .from(schema.userAccount)
      .where(eq(schema.userAccount.username, input.username.trim().toLowerCase()))
      .limit(1);

    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now)
      return { failure: 'AUTH_ACCOUNT_LOCKED' as const };
    const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;

    if (!user || !valid || user.status !== 'active') {
      if (user) {
        const failures = user.failedLogins + 1;
        const step = LOCKOUT_STEPS.find((s) => failures >= s.failures);
        await tx
          .update(schema.userAccount)
          .set({
            failedLogins: failures,
            lockedUntil: step ? new Date(now.getTime() + step.minutes * 60_000) : null,
          })
          .where(eq(schema.userAccount.id, user.id));
        await appendAudit(tx, {
          tenantId: tenant.id,
          userId: user.id,
          ip: input.ip,
          action: 'login_failed',
          entity: 'user_account',
          entityId: user.id,
        });
      }
      return { failure: 'AUTH_INVALID_CREDENTIALS' as const };
    }

    await tx
      .update(schema.userAccount)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(schema.userAccount.id, user.id));
    const permissions = await loadPermissions(tx, user.id);
    const session = await createSession(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: input.ip,
      action: 'login',
      entity: 'user_account',
      entityId: user.id,
    });

    return {
      failure: null,
      cookie: session.cookie,
      expiresAt: session.expiresAt,
      profile: {
        user: {
          id: user.id,
          displayName: user.displayName,
          title: user.title,
          username: user.username,
        },
        tenant: {
          id: tenant.id,
          code: tenant.code,
          displayName: tenant.displayName,
          isTraining: tenant.isTraining,
          status: tenant.status,
        },
        site: await siteOf(tx, user.defaultSiteId),
        permissions: [...permissions].sort(),
      },
    };
  });

  if (outcome.failure === 'AUTH_ACCOUNT_LOCKED') throw new AppError('AUTH_ACCOUNT_LOCKED', 423);
  if (outcome.failure === 'AUTH_INVALID_CREDENTIALS') {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
  }
  return { profile: outcome.profile, cookie: outcome.cookie, expiresAt: outcome.expiresAt };
}

export async function currentProfile(ctx: RequestContext): Promise<Profile> {
  const [tenant] = await withSystem(database().db, (tx) =>
    tx.select().from(schema.tenant).where(eq(schema.tenant.id, ctx.tenantId)).limit(1),
  );
  if (!tenant) throw new AppError('UNAUTHENTICATED', 401);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const [user] = await tx
      .select()
      .from(schema.userAccount)
      .where(eq(schema.userAccount.id, ctx.userId))
      .limit(1);
    if (!user || user.status !== 'active') throw new AppError('UNAUTHENTICATED', 401);
    const permissions = await loadPermissions(tx, user.id);
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        title: user.title,
        username: user.username,
      },
      tenant: {
        id: tenant.id,
        code: tenant.code,
        displayName: tenant.displayName,
        isTraining: tenant.isTraining,
        status: tenant.status,
      },
      site: await siteOf(tx, user.defaultSiteId),
      permissions: [...permissions].sort(),
    };
  });
}

function nextDeviceCode(used: ReadonlySet<string>): string {
  for (const a of DEVICE_CODE_ALPHABET) {
    for (const b of DEVICE_CODE_ALPHABET) {
      const code = `${a}${b}`;
      if (!used.has(code)) return code;
    }
  }
  throw new AppError('VALIDATION_FAILED', 409, { reason: 'DEVICE_CODES_EXHAUSTED' });
}

export async function registerDevice(
  ctx: RequestContext,
  input: {
    publicKey: string;
    name: string;
    kind: DeviceKind;
    userAgent: string | null;
    appVersion: string | null;
  },
): Promise<{ deviceId: string; deviceCode: string }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'device:register');
    const existing = await tx.select({ code: schema.device.deviceCode }).from(schema.device);
    const deviceCode = nextDeviceCode(new Set(existing.map((d) => d.code)));
    const deviceId = uuidv7();
    await tx.insert(schema.device).values({
      id: deviceId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceCode,
      name: input.name,
      kind: input.kind,
      publicKey: input.publicKey,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      appVersion: input.appVersion,
    });
    await tx
      .update(schema.session)
      .set({ deviceId })
      .where(and(eq(schema.session.id, ctx.sessionId), eq(schema.session.userId, ctx.userId)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId,
      action: 'create',
      entity: 'device',
      entityId: deviceId,
    });
    return { deviceId, deviceCode };
  });
}
