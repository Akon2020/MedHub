import 'server-only';
import { createHash } from 'node:crypto';
import {
  appendAudit,
  recordSecurityEvent,
  schema,
  withSystem,
  withTenant,
  type Tx,
} from '@medhub/db';
import { assessSignIn, deviceLabel, passwordProblems } from '@medhub/domain';
import { hashPassword, verifyPassword } from '@medhub/db/password';
import { AppError, normalizeTenantCode, uuidv7, type DeviceKind } from '@medhub/shared';
import { and, desc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { database } from '../../platform/db';
import {
  checkTotp,
  enrollmentMaterial,
  hashRecoveryCode,
  issueChallenge,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  readChallenge,
  sealSecret,
  type ChallengePurpose,
} from '../../platform/mfa';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import { enforceRateLimit, RATE_LIMITS, securityEvent } from '../../platform/security';
import { createSession, rotateSession } from '../../platform/session';
import { loadConfig } from './configuration';
import { deviceConfig, type DeviceConfig } from '@medhub/domain';
import { issueLicenseToken, issueOfflineToken, platformSigningKeys } from '../../platform/tokens';
import type { RequestContext } from '../../platform/tenant';

const LOCKOUT_STEPS: { failures: number; minutes: number }[] = [
  { failures: 20, minutes: 60 * 24 * 365 },
  { failures: 10, minutes: 15 },
  { failures: 5, minutes: 1 },
];
const SUSPENDED_STATES = new Set(['suspended', 'terminated', 'archived']);
const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SIGN_IN_HISTORY_DAYS = 180;

export type Profile = {
  user: { id: string; displayName: string; title: string | null; username: string };
  tenant: { id: string; code: string; displayName: string; isTraining: boolean; status: string };
  site: { id: string; code: string } | null;
  permissions: string[];
};

type TenantRow = typeof schema.tenant.$inferSelect;
type UserRow = typeof schema.userAccount.$inferSelect;
type Client = { ip: string | null; userAgent: string | null };

export type SignedIn = { status: 'signed_in'; profile: Profile; cookie: string; expiresAt: Date };
export type LoginResult =
  | SignedIn
  | { status: 'mfa_required'; challenge: string }
  | { status: 'mfa_enrollment_required'; challenge: string }
  | { status: 'password_change_required'; challenge: string; minLength: number };

async function siteOf(tx: Tx, siteId: string | null): Promise<{ id: string; code: string } | null> {
  if (!siteId) return null;
  const [row] = await tx
    .select({ id: schema.site.id, code: schema.site.code })
    .from(schema.site)
    .where(eq(schema.site.id, siteId))
    .limit(1);
  return row ?? null;
}

async function findTenantByCode(code: string): Promise<TenantRow | null> {
  const [row] = await withSystem(database().db, (tx) =>
    tx
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.code, normalizeTenantCode(code)))
      .limit(1),
  );
  return row ?? null;
}

async function findTenantById(id: string): Promise<TenantRow | null> {
  const [row] = await withSystem(database().db, (tx) =>
    tx.select().from(schema.tenant).where(eq(schema.tenant.id, id)).limit(1),
  );
  return row ?? null;
}

async function findUser(tx: Tx, userId: string): Promise<UserRow | null> {
  const [user] = await tx
    .select()
    .from(schema.userAccount)
    .where(eq(schema.userAccount.id, userId))
    .limit(1);
  return user ?? null;
}

async function buildProfile(tx: Tx, tenant: TenantRow, user: UserRow): Promise<Profile> {
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
}

/** A user needs at least one role in force to sign in (docs/modules/core.md). */
export async function hasActiveRole(tx: Tx, userId: string): Promise<boolean> {
  const now = new Date();
  const rows = await tx
    .select({ id: schema.userRole.id })
    .from(schema.userRole)
    .where(
      and(
        eq(schema.userRole.userId, userId),
        or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Second factor mandatory for privileged roles and roles flagged by the structure. */
export async function roleRequiresMfa(tx: Tx, userId: string): Promise<boolean> {
  const now = new Date();
  const rows = await tx
    .select({ id: schema.role.id })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
    .where(
      and(
        eq(schema.userRole.userId, userId),
        or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now)),
        or(eq(schema.role.requiresMfa, true), eq(schema.role.isPrivileged, true)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function recordFailure(
  tx: Tx,
  tenantId: string,
  user: UserRow,
  client: Client,
  action: 'login_failed' | 'mfa_failed',
): Promise<void> {
  const failures = user.failedLogins + 1;
  const step = LOCKOUT_STEPS.find((s) => failures >= s.failures);
  await tx
    .update(schema.userAccount)
    .set({
      failedLogins: failures,
      lockedUntil: step ? new Date(Date.now() + step.minutes * 60_000) : null,
    })
    .where(eq(schema.userAccount.id, user.id));
  await appendAudit(tx, {
    tenantId,
    userId: user.id,
    ip: client.ip,
    action,
    entity: 'user_account',
    entityId: user.id,
  });
}

/** Last step of every successful sign-in, whatever the factors used. */
async function openSession(
  tx: Tx,
  tenant: TenantRow,
  user: UserRow,
  client: Client,
  method: 'password' | 'totp' | 'recovery_code' | 'mfa_enrollment',
): Promise<SignedIn> {
  const now = new Date();
  await tx
    .update(schema.userAccount)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
    .where(eq(schema.userAccount.id, user.id));
  const anomalies = await detectAnomalies(tx, tenant, user, client, now);
  const session = await createSession(tx, {
    tenantId: tenant.id,
    userId: user.id,
    ip: client.ip,
    userAgent: client.userAgent,
    mfaVerifiedAt: method === 'password' ? null : now,
  });
  await appendAudit(tx, {
    tenantId: tenant.id,
    userId: user.id,
    ip: client.ip,
    action: 'login',
    entity: 'user_account',
    entityId: user.id,
    diff: anomalies.length > 0 ? { method, anomalies } : { method },
  });
  return {
    status: 'signed_in',
    cookie: session.cookie,
    expiresAt: session.expiresAt,
    profile: await buildProfile(tx, tenant, user),
  };
}

/**
 * Compares this sign-in with the user's previous sessions; anything unusual is
 * written as a security event that the structure administrators review.
 */
async function detectAnomalies(
  tx: Tx,
  tenant: TenantRow,
  user: UserRow,
  client: Client,
  now: Date,
): Promise<string[]> {
  const history = await tx
    .select({ at: schema.session.createdAt, userAgent: schema.session.userAgent })
    .from(schema.session)
    .where(
      and(
        eq(schema.session.userId, user.id),
        gt(schema.session.createdAt, new Date(now.getTime() - SIGN_IN_HISTORY_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(schema.session.createdAt))
    .limit(200);
  const anomalies = assessSignIn(
    history,
    { at: now, userAgent: client.userAgent },
    tenant.timezone,
  );
  if (anomalies.length > 0) {
    await recordSecurityEvent(tx, {
      kind: 'sign_in_anomaly',
      severity: 'warning',
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
      detail: { anomalies, device: deviceLabel(client.userAgent) },
    });
  }
  return anomalies;
}

function accountKey(tenantCode: string, username: string): string {
  return createHash('sha256')
    .update(`${normalizeTenantCode(tenantCode)}:${username.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Online sign-in: structure code, username and password, then the second
 * factor when the account has one or a role requires it. Progressive lockout
 * per account and rate limits per address; the same error for an unknown user
 * and a wrong password.
 */
export async function login(
  input: { tenantCode: string; username: string; password: string } & Client,
): Promise<LoginResult> {
  await enforceRateLimit(RATE_LIMITS.loginByIp, input.ip ?? 'unknown', { ip: input.ip });
  await enforceRateLimit(RATE_LIMITS.loginByAccount, accountKey(input.tenantCode, input.username), {
    ip: input.ip,
  });
  const tenant = await findTenantByCode(input.tenantCode);
  if (!tenant) throw new AppError('AUTH_TENANT_UNKNOWN', 404);
  if (SUSPENDED_STATES.has(tenant.status)) throw new AppError('AUTH_TENANT_SUSPENDED', 403);

  // Failures are returned, not thrown, so that the lockout counter and the audit
  // entry are committed with the transaction.
  const outcome = await withTenant(
    database().db,
    { tenantId: tenant.id, userId: null },
    async (
      tx,
    ): Promise<
      | LoginResult
      | {
          status: 'failed';
          code: 'AUTH_ACCOUNT_LOCKED' | 'AUTH_INVALID_CREDENTIALS' | 'AUTH_NO_ACTIVE_ROLE';
        }
    > => {
      const [user] = await tx
        .select()
        .from(schema.userAccount)
        .where(eq(schema.userAccount.username, input.username.trim().toLowerCase()))
        .limit(1);

      if (user?.lockedUntil && user.lockedUntil > new Date())
        return { status: 'failed', code: 'AUTH_ACCOUNT_LOCKED' };
      const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;

      if (!user || !valid || user.status !== 'active') {
        if (user) await recordFailure(tx, tenant.id, user, input, 'login_failed');
        return { status: 'failed', code: 'AUTH_INVALID_CREDENTIALS' };
      }

      if (!(await hasActiveRole(tx, user.id))) {
        await appendAudit(tx, {
          tenantId: tenant.id,
          userId: user.id,
          ip: input.ip,
          action: 'login_refused_no_role',
          entity: 'user_account',
          entityId: user.id,
        });
        return { status: 'failed', code: 'AUTH_NO_ACTIVE_ROLE' };
      }
      if (user.mustChangePassword) {
        const values = await loadConfig(tx);
        return {
          status: 'password_change_required',
          challenge: issueChallenge({ tenantId: tenant.id, userId: user.id, purpose: 'password' }),
          minLength: values['security.password_min_length'],
        };
      }
      return afterPassword(tx, tenant, user, input);
    },
  );

  if (outcome.status === 'failed') {
    const status =
      outcome.code === 'AUTH_ACCOUNT_LOCKED'
        ? 423
        : outcome.code === 'AUTH_NO_ACTIVE_ROLE'
          ? 403
          : 401;
    throw new AppError(outcome.code, status);
  }
  return outcome;
}

/** Once the password is settled: second factor if any, otherwise the session. */
async function afterPassword(
  tx: Tx,
  tenant: TenantRow,
  user: UserRow,
  client: Client,
): Promise<LoginResult> {
  // The failure counter is only reset once every factor has succeeded.
  if (user.mfaEnabledAt) {
    return {
      status: 'mfa_required',
      challenge: issueChallenge({ tenantId: tenant.id, userId: user.id, purpose: 'verify' }),
    };
  }
  if (await roleRequiresMfa(tx, user.id)) {
    return {
      status: 'mfa_enrollment_required',
      challenge: issueChallenge({ tenantId: tenant.id, userId: user.id, purpose: 'enroll' }),
    };
  }
  return openSession(tx, tenant, user, client, 'password');
}

/** Rejects a password that breaks the structure's policy or repeats the current one. */
async function checkNewPassword(tx: Tx, user: UserRow, password: string): Promise<void> {
  const values = await loadConfig(tx);
  const minLength = values['security.password_min_length'];
  const problems = passwordProblems(password, {
    minLength,
    identity: [user.username, user.displayName, user.email],
  });
  if (problems.length > 0) throw new AppError('AUTH_PASSWORD_WEAK', 422, { problems, minLength });
  if (await verifyPassword(user.passwordHash, password)) {
    throw new AppError('AUTH_PASSWORD_REUSED', 422);
  }
}

async function storePassword(tx: Tx, userId: string, password: string): Promise<void> {
  const now = new Date();
  await tx
    .update(schema.userAccount)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: now,
      mustChangePassword: false,
      updatedAt: now,
    })
    .where(eq(schema.userAccount.id, userId));
}

/**
 * First sign-in with a temporary password (created or reset by an
 * administrator): the user chooses their own before going any further.
 */
export async function changeInitialPassword(
  input: { challenge: string; password: string } & Client,
): Promise<LoginResult> {
  const { tenant, userId } = await challengeContext(input.challenge, 'password', input.ip);
  return withTenant(database().db, { tenantId: tenant.id, userId }, async (tx) => {
    const user = await findUser(tx, userId);
    if (!user || user.status !== 'active' || !user.mustChangePassword) {
      throw new AppError('AUTH_MFA_CHALLENGE_EXPIRED', 401);
    }
    await checkNewPassword(tx, user, input.password);
    await storePassword(tx, user.id, input.password);
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: input.ip,
      action: 'password_change',
      entity: 'user_account',
      entityId: user.id,
      diff: { reason: 'temporary' },
    });
    return afterPassword(tx, tenant, { ...user, mustChangePassword: false }, input);
  });
}

async function challengeContext(
  token: string,
  purpose: ChallengePurpose,
  ip: string | null,
): Promise<{ tenant: TenantRow; userId: string }> {
  const challenge = readChallenge(token);
  if (!challenge || challenge.purpose !== purpose) {
    throw new AppError('AUTH_MFA_CHALLENGE_EXPIRED', 401);
  }
  await enforceRateLimit(RATE_LIMITS.mfaByUser, challenge.userId, {
    ip,
    tenantId: challenge.tenantId,
  });
  const tenant = await findTenantById(challenge.tenantId);
  if (!tenant) throw new AppError('AUTH_MFA_CHALLENGE_EXPIRED', 401);
  if (SUSPENDED_STATES.has(tenant.status)) throw new AppError('AUTH_TENANT_SUSPENDED', 403);
  return { tenant, userId: challenge.userId };
}

type FactorCheck =
  { ok: true; method: 'totp' | 'recovery_code'; step: number | null } | { ok: false };

/** Six digits: authenticator app. Otherwise: single-use recovery code. */
async function checkSecondFactor(
  tx: Tx,
  tenantId: string,
  user: UserRow,
  code: string,
): Promise<FactorCheck> {
  if (!user.mfaSecretEnc || !user.mfaEnabledAt) return { ok: false };
  const trimmed = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(trimmed)) {
    const step = await checkTotp(
      openSecret(tenantId, user.mfaSecretEnc),
      trimmed,
      user.mfaLastStep,
    );
    if (step === null) return { ok: false };
    await tx
      .update(schema.userAccount)
      .set({ mfaLastStep: step })
      .where(eq(schema.userAccount.id, user.id));
    return { ok: true, method: 'totp', step };
  }
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return { ok: false };
  const used = await tx
    .update(schema.mfaRecoveryCode)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.mfaRecoveryCode.userId, user.id),
        eq(schema.mfaRecoveryCode.codeHash, hashRecoveryCode(normalized)),
        isNull(schema.mfaRecoveryCode.usedAt),
      ),
    )
    .returning({ id: schema.mfaRecoveryCode.id });
  return used.length > 0 ? { ok: true, method: 'recovery_code', step: null } : { ok: false };
}

/** Second step of sign-in for an account that has a second factor. */
export async function verifyMfa(
  input: { challenge: string; code: string } & Client,
): Promise<SignedIn> {
  const { tenant, userId } = await challengeContext(input.challenge, 'verify', input.ip);
  const outcome = await withTenant(
    database().db,
    { tenantId: tenant.id, userId },
    async (
      tx,
    ): Promise<
      SignedIn | { status: 'failed'; code: 'AUTH_ACCOUNT_LOCKED' | 'AUTH_MFA_INVALID' }
    > => {
      const user = await findUser(tx, userId);
      if (!user || user.status !== 'active') return { status: 'failed', code: 'AUTH_MFA_INVALID' };
      if (user.lockedUntil && user.lockedUntil > new Date())
        return { status: 'failed', code: 'AUTH_ACCOUNT_LOCKED' };
      const factor = await checkSecondFactor(tx, tenant.id, user, input.code);
      if (!factor.ok) {
        await recordFailure(tx, tenant.id, user, input, 'mfa_failed');
        return { status: 'failed', code: 'AUTH_MFA_INVALID' };
      }
      return openSession(tx, tenant, user, input, factor.method);
    },
  );
  if (outcome.status === 'failed') {
    throw new AppError(outcome.code, outcome.code === 'AUTH_ACCOUNT_LOCKED' ? 423 : 401);
  }
  return outcome;
}

export type EnrollmentMaterial = { secret: string; uri: string; qrSvg: string };

/** A new pending secret; it only becomes active once a first code is confirmed. */
async function prepareSecret(
  tx: Tx,
  tenant: TenantRow,
  user: UserRow,
): Promise<EnrollmentMaterial> {
  if (user.mfaEnabledAt) throw new AppError('AUTH_MFA_ALREADY_ENABLED', 409);
  const secret = newTotpSecret();
  await tx
    .update(schema.userAccount)
    .set({ mfaSecretEnc: sealSecret(tenant.id, secret), mfaLastStep: null })
    .where(eq(schema.userAccount.id, user.id));
  return { secret, ...(await enrollmentMaterial(secret, user.username, tenant.code)) };
}

/**
 * Confirms the pending secret with a first code and issues fresh recovery codes.
 * Returns null when the code is wrong.
 */
async function activateSecret(
  tx: Tx,
  tenant: TenantRow,
  user: UserRow,
  code: string,
  client: Client,
): Promise<string[] | null> {
  if (user.mfaEnabledAt) throw new AppError('AUTH_MFA_ALREADY_ENABLED', 409);
  if (!user.mfaSecretEnc) throw new AppError('AUTH_MFA_NOT_ENROLLED', 409);
  const step = await checkTotp(openSecret(tenant.id, user.mfaSecretEnc), code.trim(), null);
  if (step === null) return null;
  await tx
    .update(schema.userAccount)
    .set({ mfaEnabledAt: new Date(), mfaLastStep: step })
    .where(eq(schema.userAccount.id, user.id));
  const codes = await replaceRecoveryCodes(tx, tenant.id, user.id);
  await appendAudit(tx, {
    tenantId: tenant.id,
    userId: user.id,
    ip: client.ip,
    action: 'mfa_enabled',
    entity: 'user_account',
    entityId: user.id,
  });
  return codes;
}

/** Recovery codes are credentials, not records: old ones are simply replaced. */
async function replaceRecoveryCodes(tx: Tx, tenantId: string, userId: string): Promise<string[]> {
  await tx.delete(schema.mfaRecoveryCode).where(eq(schema.mfaRecoveryCode.userId, userId));
  const codes = newRecoveryCodes();
  await tx.insert(schema.mfaRecoveryCode).values(
    codes.map((code) => ({
      id: uuidv7(),
      tenantId,
      userId,
      codeHash: hashRecoveryCode(code),
    })),
  );
  return codes;
}

/** Enrollment imposed at sign-in by a role: first the secret... */
export async function startEnrollment(
  input: { challenge: string } & Client,
): Promise<EnrollmentMaterial> {
  const { tenant, userId } = await challengeContext(input.challenge, 'enroll', input.ip);
  return withTenant(database().db, { tenantId: tenant.id, userId }, async (tx) => {
    const user = await findUser(tx, userId);
    if (!user || user.status !== 'active') throw new AppError('AUTH_MFA_CHALLENGE_EXPIRED', 401);
    return prepareSecret(tx, tenant, user);
  });
}

/** ...then the first code, which also opens the session. */
export async function completeEnrollment(
  input: { challenge: string; code: string } & Client,
): Promise<SignedIn & { recoveryCodes: string[] }> {
  const { tenant, userId } = await challengeContext(input.challenge, 'enroll', input.ip);
  const outcome = await withTenant(database().db, { tenantId: tenant.id, userId }, async (tx) => {
    const user = await findUser(tx, userId);
    if (!user || user.status !== 'active') return null;
    const codes = await activateSecret(tx, tenant, user, input.code, input);
    if (!codes) {
      await recordFailure(tx, tenant.id, user, input, 'mfa_failed');
      return null;
    }
    return {
      ...(await openSession(tx, tenant, user, input, 'mfa_enrollment')),
      recoveryCodes: codes,
    };
  });
  if (!outcome) throw new AppError('AUTH_MFA_INVALID', 401);
  await securityEvent({ kind: 'mfa_enabled', tenantId: tenant.id, userId, ip: input.ip });
  return outcome;
}

export async function currentProfile(ctx: RequestContext): Promise<Profile> {
  const tenant = await findTenantById(ctx.tenantId);
  if (!tenant) throw new AppError('UNAUTHENTICATED', 401);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const user = await findUser(tx, ctx.userId);
    if (!user || user.status !== 'active') throw new AppError('UNAUTHENTICATED', 401);
    return buildProfile(tx, tenant, user);
  });
}

export type SecurityOverview = {
  mfa: {
    enabled: boolean;
    enabledAt: string | null;
    requiredByRole: boolean;
    recoveryCodesLeft: number;
  };
  sessions: {
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    userAgent: string | null;
    ip: string | null;
    deviceId: string | null;
  }[];
};

export async function securityOverview(ctx: RequestContext): Promise<SecurityOverview> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const user = await findUser(tx, ctx.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 401);
    const codes = await tx
      .select({ id: schema.mfaRecoveryCode.id })
      .from(schema.mfaRecoveryCode)
      .where(
        and(eq(schema.mfaRecoveryCode.userId, user.id), isNull(schema.mfaRecoveryCode.usedAt)),
      );
    const sessions = await tx
      .select()
      .from(schema.session)
      .where(
        and(
          eq(schema.session.userId, user.id),
          isNull(schema.session.revokedAt),
          gt(schema.session.expiresAt, new Date()),
        ),
      );
    return {
      mfa: {
        enabled: user.mfaEnabledAt !== null,
        enabledAt: user.mfaEnabledAt?.toISOString() ?? null,
        requiredByRole: await roleRequiresMfa(tx, user.id),
        recoveryCodesLeft: user.mfaEnabledAt ? codes.length : 0,
      },
      sessions: sessions
        .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
        .map((s) => ({
          id: s.id,
          current: s.id === ctx.sessionId,
          createdAt: s.createdAt.toISOString(),
          lastSeenAt: s.lastSeenAt.toISOString(),
          userAgent: s.userAgent,
          ip: s.ip,
          deviceId: s.deviceId,
        })),
    };
  });
}

async function withAccount<T>(
  ctx: RequestContext,
  fn: (tx: Tx, tenant: TenantRow, user: UserRow) => Promise<T>,
): Promise<T> {
  const tenant = await findTenantById(ctx.tenantId);
  if (!tenant) throw new AppError('UNAUTHENTICATED', 401);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const user = await findUser(tx, ctx.userId);
    if (!user || user.status !== 'active') throw new AppError('UNAUTHENTICATED', 401);
    return fn(tx, tenant, user);
  });
}

/** Optional enrollment from the account page, for roles that do not impose it. */
export async function beginMfaSetup(ctx: RequestContext): Promise<EnrollmentMaterial> {
  return withAccount(ctx, (tx, tenant, user) => prepareSecret(tx, tenant, user));
}

export type RotatedSession = { cookie: string; expiresAt: Date };

/** Turning the second factor on elevates the session: its identifier is rotated. */
export async function confirmMfaSetup(
  ctx: RequestContext,
  code: string,
  client: Client,
): Promise<{ recoveryCodes: string[]; session: RotatedSession }> {
  const outcome = await withAccount(ctx, async (tx, tenant, user) => {
    const codes = await activateSecret(tx, tenant, user, code, client);
    if (!codes) return null;
    const session = await rotateSession(tx, ctx, { ...client, mfaVerifiedAt: new Date() });
    return { recoveryCodes: codes, session };
  });
  if (!outcome) throw new AppError('AUTH_MFA_INVALID', 401);
  await securityEvent({
    kind: 'mfa_enabled',
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    ip: client.ip,
  });
  return outcome;
}

/**
 * Step-up: the second factor proven again inside a session, before a sensitive
 * change. The session identifier is rotated at the same time.
 */
export async function stepUp(
  ctx: RequestContext,
  code: string,
  client: Client,
): Promise<RotatedSession> {
  await enforceRateLimit(RATE_LIMITS.mfaByUser, ctx.userId, {
    ip: client.ip,
    tenantId: ctx.tenantId,
  });
  const outcome = await withAccount(ctx, async (tx, tenant, user) => {
    if (!user.mfaEnabledAt) return { failure: 'AUTH_MFA_NOT_ENROLLED' as const };
    const factor = await checkSecondFactor(tx, tenant.id, user, code);
    if (!factor.ok) {
      await recordFailure(tx, tenant.id, user, client, 'mfa_failed');
      return { failure: 'AUTH_MFA_INVALID' as const };
    }
    const session = await rotateSession(tx, ctx, { ...client, mfaVerifiedAt: new Date() });
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
      action: 'step_up',
      entity: 'session',
      entityId: session.sessionId,
      diff: { method: factor.method },
    });
    return { failure: null, session };
  });
  if (outcome.failure === 'AUTH_MFA_NOT_ENROLLED') throw new AppError(outcome.failure, 409);
  if (outcome.failure === 'AUTH_MFA_INVALID') throw new AppError(outcome.failure, 401);
  return outcome.session;
}

/** Sensitive account changes require a fresh second factor, not just the session. */
async function requireFreshFactor(
  tx: Tx,
  tenant: TenantRow,
  user: UserRow,
  code: string,
): Promise<void> {
  const factor = await checkSecondFactor(tx, tenant.id, user, code);
  if (!factor.ok) throw new AppError('AUTH_MFA_INVALID', 401);
}

export async function regenerateRecoveryCodes(
  ctx: RequestContext,
  code: string,
  client: Client,
): Promise<string[]> {
  await enforceRateLimit(RATE_LIMITS.mfaByUser, ctx.userId, {
    ip: client.ip,
    tenantId: ctx.tenantId,
  });
  return withAccount(ctx, async (tx, tenant, user) => {
    if (!user.mfaEnabledAt) throw new AppError('AUTH_MFA_NOT_ENROLLED', 409);
    await requireFreshFactor(tx, tenant, user, code);
    const codes = await replaceRecoveryCodes(tx, tenant.id, user.id);
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
      action: 'mfa_recovery_regenerated',
      entity: 'user_account',
      entityId: user.id,
    });
    return codes;
  });
}

export async function disableMfa(ctx: RequestContext, code: string, client: Client): Promise<void> {
  await enforceRateLimit(RATE_LIMITS.mfaByUser, ctx.userId, {
    ip: client.ip,
    tenantId: ctx.tenantId,
  });
  await withAccount(ctx, async (tx, tenant, user) => {
    if (!user.mfaEnabledAt) throw new AppError('AUTH_MFA_NOT_ENROLLED', 409);
    if (await roleRequiresMfa(tx, user.id)) throw new AppError('AUTH_MFA_REQUIRED_BY_ROLE', 409);
    await requireFreshFactor(tx, tenant, user, code);
    await tx
      .update(schema.userAccount)
      .set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null })
      .where(eq(schema.userAccount.id, user.id));
    await tx.delete(schema.mfaRecoveryCode).where(eq(schema.mfaRecoveryCode.userId, user.id));
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
      action: 'mfa_disabled',
      entity: 'user_account',
      entityId: user.id,
    });
  });
  await securityEvent({
    kind: 'mfa_disabled',
    severity: 'warning',
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    ip: client.ip,
  });
}

/** Change from the account page: the current password is required, other sessions end. */
export async function changePassword(
  ctx: RequestContext,
  input: { current: string; password: string },
  client: Client,
): Promise<void> {
  await enforceRateLimit(RATE_LIMITS.mfaByUser, ctx.userId, {
    ip: client.ip,
    tenantId: ctx.tenantId,
  });
  await withAccount(ctx, async (tx, tenant, user) => {
    if (!(await verifyPassword(user.passwordHash, input.current))) {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
    }
    await checkNewPassword(tx, user, input.password);
    await storePassword(tx, user.id, input.password);
    await tx
      .update(schema.session)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.session.userId, user.id),
          isNull(schema.session.revokedAt),
          ne(schema.session.id, ctx.sessionId),
        ),
      );
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
      action: 'password_change',
      entity: 'user_account',
      entityId: user.id,
      diff: { reason: 'self' },
    });
    await recordSecurityEvent(tx, {
      kind: 'password_changed',
      severity: 'info',
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
    });
  });
}

/** Revokes one other session of the user, or all of them except the current one. */
export async function revokeSessions(
  ctx: RequestContext,
  target: { sessionId: string } | { others: true },
  client: Client,
): Promise<number> {
  return withAccount(ctx, async (tx, tenant, user) => {
    const conditions = [eq(schema.session.userId, user.id), isNull(schema.session.revokedAt)];
    const revoked = await tx
      .update(schema.session)
      .set({ revokedAt: new Date() })
      .where(
        'sessionId' in target
          ? and(...conditions, eq(schema.session.id, target.sessionId))
          : and(...conditions, ne(schema.session.id, ctx.sessionId)),
      )
      .returning({ id: schema.session.id });
    await appendAudit(tx, {
      tenantId: tenant.id,
      userId: user.id,
      ip: client.ip,
      action: 'session_revoked',
      entity: 'session',
      diff: { count: revoked.length },
    });
    return revoked.length;
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
): Promise<{ deviceId: string; deviceCode: string; tokens: DeviceTokens }> {
  const tenant = await findTenantById(ctx.tenantId);
  if (!tenant) throw new AppError('UNAUTHENTICATED', 401);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'device:register');
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
    return {
      deviceId,
      deviceCode,
      tokens: deviceTokensFor(tenant, await loadConfig(tx), {
        userId: ctx.userId,
        deviceId,
        permissions,
      }),
    };
  });
}

/** What a device needs to keep working offline: both tokens and the keys that verify them. */
export type DeviceTokens = {
  offlineToken: string;
  licenseToken: string;
  signingKeys: Record<string, string>;
  serverTime: number;
  /** Published settings the device applies offline (auto-lock, PIN attempts). */
  config: DeviceConfig;
};

export function deviceTokensFor(
  tenant: { id: string; status: string },
  config: Awaited<ReturnType<typeof loadConfig>>,
  input: { userId: string; deviceId: string; permissions: Iterable<string> },
): DeviceTokens {
  return {
    config: deviceConfig(config),
    offlineToken: issueOfflineToken({
      tenantId: tenant.id,
      ...input,
      days: config['security.offline_token_days'],
    }),
    licenseToken: issueLicenseToken(tenant),
    signingKeys: platformSigningKeys(),
    serverTime: Date.now(),
  };
}

/** Renewed after every successful synchronisation, for an active device of the user only. */
export async function refreshDeviceTokens(
  ctx: RequestContext,
  deviceId: string,
): Promise<DeviceTokens> {
  const tenant = await findTenantById(ctx.tenantId);
  if (!tenant) throw new AppError('UNAUTHENTICATED', 401);
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const [device] = await tx
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, deviceId))
      .limit(1);
    if (!device || device.userId !== ctx.userId) throw new AppError('DEVICE_UNKNOWN', 403);
    if (device.status !== 'active') throw new AppError('DEVICE_REVOKED', 403);
    const permissions = await loadPermissions(tx, ctx.userId);
    return deviceTokensFor(tenant, await loadConfig(tx), {
      userId: ctx.userId,
      deviceId,
      permissions,
    });
  });
}
