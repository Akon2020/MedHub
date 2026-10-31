import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { hashPassword } from '@medhub/db/password';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const adminId = uuidv7();
const clerkId = uuidv7();
const adminRole = uuidv7();
const clerkRole = uuidv7();
const code = `TST-USR-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const ADMIN_PASSWORD = 'phrase de test pour administrateur';
const client = { ip: '203.0.113.20', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' };

let handle: DbHandle;
type Users = typeof import('@/server/modules/core/users');
type Core = typeof import('@/server/modules/core/service');
type Session = typeof import('@/server/platform/session');
type Ctx = Parameters<Users['listUsers']>[0];
let users: Users;
let core: Core;
let session: Session;

function ctxFor(userId: string, mfaVerifiedAt: Date | null = new Date()): Ctx {
  return { tenantId, userId, sessionId: uuidv7(), deviceId: null, mfaVerifiedAt };
}

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) ? error.code : error).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

async function account(userId: string) {
  const [row] = await tx((t) =>
    t.select().from(schema.userAccount).where(eq(schema.userAccount.id, userId)),
  );
  if (!row) throw new Error(userId);
  return row;
}

function signIn(username: string, password: string) {
  return core.login({ tenantCode: code, username, password, ...client });
}

describe.skipIf(!url)('user management against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 5).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    users = await import('@/server/modules/core/users');
    core = await import('@/server/modules/core/service');
    session = await import('@/server/platform/session');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (t) =>
      t.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Structure de test utilisateurs',
        displayName: 'Structure de test utilisateurs',
        type: 'clinic',
        status: 'active',
      }),
    );
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    await tx(async (t) => {
      await t.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'tenant_admin', name: 'Administrateur' },
        { id: clerkRole, tenantId, code: 'receptionist', name: 'Accueil' },
      ]);
      await t
        .insert(schema.rolePermission)
        .values([
          ...[
            'user:read',
            'user:create',
            'user:update',
            'user:disable',
            'user:reset_password',
            'role:manage',
          ].map((permissionKey) => ({ tenantId, roleId: adminRole, permissionKey })),
          { tenantId, roleId: clerkRole, permissionKey: 'patient:read' },
          { tenantId, roleId: clerkRole, permissionKey: 'user:disable' },
        ]);
      await t.insert(schema.userAccount).values([
        { id: adminId, tenantId, username: 'admin', displayName: 'Admin fictif', passwordHash },
        { id: clerkId, tenantId, username: 'accueil', displayName: 'Accueil fictif', passwordHash },
      ]);
      await t.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: clerkId, roleId: clerkRole },
      ]);
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  let createdId = '';
  let temporary = '';
  let clerkTemporary = '';

  it('creates a user with a temporary password and refuses a taken username', async () => {
    await expectCode(
      users.createUser(
        ctxFor(adminId, null),
        {
          username: 'j.mukendi',
          displayName: 'Jeanne Mukendi',
          locale: 'fr',
          roleIds: [clerkRole],
        },
        client,
      ),
      'AUTH_STEP_UP_REQUIRED',
    );
    await expectCode(
      users.createUser(
        ctxFor(clerkId),
        { username: 'x.test', displayName: 'Test', locale: 'fr', roleIds: [clerkRole] },
        client,
      ),
      'PERMISSION_DENIED',
    );
    const created = await users.createUser(
      ctxFor(adminId),
      {
        username: 'j.mukendi',
        displayName: 'Jeanne Mukendi',
        title: 'Inf.',
        locale: 'fr',
        roleIds: [clerkRole],
      },
      client,
    );
    createdId = created.userId;
    temporary = created.temporaryPassword;
    expect(temporary.length).toBeGreaterThanOrEqual(10);
    expect((await account(createdId)).mustChangePassword).toBe(true);
    await expectCode(
      users.createUser(
        ctxFor(adminId),
        { username: 'j.mukendi', displayName: 'Autre', locale: 'fr', roleIds: [clerkRole] },
        client,
      ),
      'USER_USERNAME_TAKEN',
    );
    await expectCode(
      users.createUser(
        ctxFor(adminId),
        { username: 'role.inconnu', displayName: 'Autre', locale: 'fr', roleIds: [uuidv7()] },
        client,
      ),
      'USER_ROLE_UNKNOWN',
    );
  });

  it('makes the user replace the temporary password at first sign-in', async () => {
    const first = await signIn('j.mukendi', temporary);
    expect(first.status).toBe('password_change_required');
    if (first.status !== 'password_change_required') return;
    expect(first.minLength).toBe(10);
    await expectCode(
      core.changeInitialPassword({ challenge: first.challenge, password: 'azerty2024', ...client }),
      'AUTH_PASSWORD_WEAK',
    );
    await expectCode(
      core.changeInitialPassword({ challenge: first.challenge, password: temporary, ...client }),
      'AUTH_PASSWORD_REUSED',
    );
    const done = await core.changeInitialPassword({
      challenge: first.challenge,
      password: 'le fleuve coule vers la mer',
      ...client,
    });
    expect(done.status).toBe('signed_in');
    expect((await account(createdId)).mustChangePassword).toBe(false);
    expect((await signIn('j.mukendi', 'le fleuve coule vers la mer')).status).toBe('signed_in');
  });

  it('updates the profile and roles, keeping the ended assignment', async () => {
    await users.updateUser(
      ctxFor(adminId),
      {
        userId: createdId,
        displayName: 'Jeanne Mukendi Kabila',
        title: 'Inf.',
        locale: 'en',
        roleIds: [adminRole],
      },
      client,
    );
    const overview = await users.listUsers(ctxFor(adminId, null));
    const listed = overview.users.find((u) => u.id === createdId);
    expect(listed).toMatchObject({
      displayName: 'Jeanne Mukendi Kabila',
      locale: 'en',
      roleIds: [adminRole],
    });
    const assignments = await tx((t) =>
      t.select().from(schema.userRole).where(eq(schema.userRole.userId, createdId)),
    );
    expect(assignments).toHaveLength(2);
    expect(assignments.filter((a) => a.validUntil !== null)).toHaveLength(1);
  });

  it('never lets the structure lose its last administrator', async () => {
    await expectCode(
      users.setUserStatus(
        ctxFor(adminId),
        { userId: adminId, status: 'disabled', reason: 'Essai' },
        client,
      ),
      'USER_IS_SELF',
    );
    await users.setUserStatus(
      ctxFor(adminId),
      { userId: createdId, status: 'disabled', reason: 'Départ de la structure' },
      client,
    );
    await expectCode(
      users.updateUser(
        ctxFor(adminId),
        { userId: adminId, displayName: 'Admin fictif', locale: 'fr', roleIds: [clerkRole] },
        client,
      ),
      'USER_LAST_ADMIN',
    );
    await expectCode(
      users.setUserStatus(
        ctxFor(clerkId),
        { userId: adminId, status: 'disabled', reason: 'Essai' },
        client,
      ),
      'USER_LAST_ADMIN',
    );
    expect(await account(adminId)).toMatchObject({ status: 'active' });
    expect(
      (await users.listUsers(ctxFor(adminId))).users.find((u) => u.id === adminId)?.roleIds,
    ).toEqual([adminRole]);
    await users.setUserStatus(
      ctxFor(adminId),
      { userId: createdId, status: 'active', reason: 'Retour dans la structure' },
      client,
    );
    await users.updateUser(
      ctxFor(adminId),
      {
        userId: createdId,
        displayName: 'Jeanne Mukendi Kabila',
        locale: 'en',
        roleIds: [clerkRole],
      },
      client,
    );
  });

  it('ends the sessions of a disabled user and explains why', async () => {
    const signedIn = await signIn('accueil', ADMIN_PASSWORD);
    expect(signedIn.status).toBe('signed_in');
    if (signedIn.status !== 'signed_in') return;
    await users.setUserStatus(
      ctxFor(adminId),
      { userId: clerkId, status: 'disabled', reason: 'Compte partagé' },
      client,
    );
    expect(await session.lookupSession(signedIn.cookie)).toBeNull();
    expect(await session.sessionEndReason(signedIn.cookie)).toBe('user_disabled');
    await expectCode(signIn('accueil', ADMIN_PASSWORD), 'AUTH_INVALID_CREDENTIALS');
    await users.setUserStatus(
      ctxFor(adminId),
      { userId: clerkId, status: 'active', reason: 'Compte individuel créé' },
      client,
    );
  });

  it('resets the password, unlocks and resets the second factor', async () => {
    await tx((t) =>
      t
        .update(schema.userAccount)
        .set({
          failedLogins: 12,
          lockedUntil: new Date(Date.now() + 600_000),
          mfaSecretEnc: 'sealed',
          mfaEnabledAt: new Date(),
        })
        .where(eq(schema.userAccount.id, clerkId)),
    );
    await expectCode(signIn('accueil', ADMIN_PASSWORD), 'AUTH_ACCOUNT_LOCKED');
    await users.unlockUser(ctxFor(adminId), { userId: clerkId }, client);
    expect((await account(clerkId)).lockedUntil).toBeNull();

    await users.resetMfa(ctxFor(adminId), { userId: clerkId, reason: 'Téléphone perdu' }, client);
    const reset = await account(clerkId);
    expect(reset.mfaEnabledAt).toBeNull();
    expect(reset.mfaSecretEnc).toBeNull();
    await expectCode(
      users.resetMfa(ctxFor(adminId), { userId: clerkId, reason: 'Encore' }, client),
      'AUTH_MFA_NOT_ENROLLED',
    );

    const reset2 = await users.resetPassword(ctxFor(adminId), { userId: clerkId }, client);
    clerkTemporary = reset2.temporaryPassword;
    await expectCode(signIn('accueil', ADMIN_PASSWORD), 'AUTH_INVALID_CREDENTIALS');
    expect((await signIn('accueil', clerkTemporary)).status).toBe('password_change_required');
    await expectCode(
      users.resetPassword(ctxFor(adminId), { userId: adminId }, client),
      'USER_IS_SELF',
    );
  });

  it('refuses sign-in to a user without any active role', async () => {
    await tx((t) =>
      t
        .update(schema.userRole)
        .set({ validUntil: new Date(Date.now() - 1000) })
        .where(eq(schema.userRole.userId, clerkId)),
    );
    await expectCode(signIn('accueil', clerkTemporary), 'AUTH_NO_ACTIVE_ROLE');
  });

  it('lets a user change their own password and writes a valid audit chain', async () => {
    const signedIn = await signIn('admin', ADMIN_PASSWORD);
    expect(signedIn.status).toBe('signed_in');
    await expectCode(
      core.changePassword(
        ctxFor(adminId),
        { current: 'mauvais mot de passe', password: 'une autre phrase solide' },
        client,
      ),
      'AUTH_INVALID_CREDENTIALS',
    );
    await expectCode(
      core.changePassword(
        ctxFor(adminId),
        { current: ADMIN_PASSWORD, password: 'admin fictif 2026' },
        client,
      ),
      'AUTH_PASSWORD_WEAK',
    );
    await core.changePassword(
      ctxFor(adminId),
      { current: ADMIN_PASSWORD, password: 'une autre phrase solide' },
      client,
    );
    if (signedIn.status === 'signed_in') {
      expect(await session.lookupSession(signedIn.cookie)).toBeNull();
    }
    const audit = await tx((t) =>
      t.select({ action: schema.auditLog.action }).from(schema.auditLog),
    );
    const actions = new Set(audit.map((a) => a.action));
    for (const action of [
      'user_create',
      'user_update',
      'user_disable',
      'user_enable',
      'password_reset',
      'mfa_reset',
      'user_unlock',
      'password_change',
      'login_refused_no_role',
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    const chain = await tx((t) => verifyAuditChain(t, tenantId));
    expect(chain.ok).toBe(true);
  });
});
