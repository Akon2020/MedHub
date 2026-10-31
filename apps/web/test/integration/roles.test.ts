import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { ROLE_TEMPLATES, isAppError, uuidv7 } from '@medhub/shared';
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
const code = `TST-ROL-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const client = { ip: '203.0.113.30' };

let handle: DbHandle;
type Roles = typeof import('@/server/modules/core/roles');
type Permissions = typeof import('@/server/platform/permissions');
type Ctx = Parameters<Roles['listRoles']>[0];
let roles: Roles;
let permissions: Permissions;

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

const adminTemplate = ROLE_TEMPLATES.find((t) => t.code === 'tenant_admin');
const adminGrants = (adminTemplate?.permissions ?? []).map((key) => ({
  key,
  scope: 'tenant' as const,
}));

async function view(roleId: string) {
  const found = (await roles.listRoles(ctxFor(adminId))).roles.find((r) => r.id === roleId);
  if (!found) throw new Error(roleId);
  return found;
}

describe.skipIf(!url)('role editor against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 6).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    roles = await import('@/server/modules/core/roles');
    permissions = await import('@/server/platform/permissions');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (t) =>
      t.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Structure de test rôles',
        displayName: 'Structure de test rôles',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tx(async (t) => {
      await t.insert(schema.role).values([
        {
          id: adminRole,
          tenantId,
          code: 'tenant_admin',
          name: 'Administrateur',
          isPrivileged: true,
          requiresMfa: true,
          templateCode: 'tenant_admin',
        },
        {
          id: clerkRole,
          tenantId,
          code: 'receptionist',
          name: 'Accueil',
          templateCode: 'receptionist',
        },
      ]);
      await t
        .insert(schema.rolePermission)
        .values([
          ...adminGrants.map((g) => ({ tenantId, roleId: adminRole, permissionKey: g.key })),
          { tenantId, roleId: clerkRole, permissionKey: 'patient:read' },
          { tenantId, roleId: clerkRole, permissionKey: 'role:read' },
        ]);
      await t.insert(schema.userAccount).values([
        {
          id: adminId,
          tenantId,
          username: 'admin',
          displayName: 'Admin fictif',
          passwordHash: 'x',
        },
        {
          id: clerkId,
          tenantId,
          username: 'accueil',
          displayName: 'Accueil fictif',
          passwordHash: 'x',
        },
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

  it('lists roles with grants and members, and reserves changes to role:manage', async () => {
    const overview = await roles.listRoles(ctxFor(clerkId));
    expect(overview.canManage).toBe(false);
    expect(overview.roles.find((r) => r.id === clerkRole)).toMatchObject({
      members: 1,
      grants: [
        { key: 'patient:read', scope: 'tenant' },
        { key: 'role:read', scope: 'tenant' },
      ],
    });
    await expectCode(
      roles.updateRole(
        ctxFor(clerkId),
        { roleId: clerkRole, name: 'Accueil', requiresMfa: false, grants: [] },
        client,
      ),
      'PERMISSION_DENIED',
    );
    await expectCode(
      roles.createRole(
        ctxFor(adminId, null),
        { code: 'soir', name: 'Soir', requiresMfa: false },
        client,
      ),
      'AUTH_STEP_UP_REQUIRED',
    );
  });

  it('edits the grid with scopes and applies it at the next request', async () => {
    await roles.updateRole(
      ctxFor(adminId),
      {
        roleId: clerkRole,
        name: 'Accueil et rendez-vous',
        description: 'Accueil du matin',
        requiresMfa: false,
        grants: [
          { key: 'patient:read', scope: 'site' },
          { key: 'patient:create', scope: 'site' },
          { key: 'appointment:read', scope: 'department' },
        ],
      },
      client,
    );
    const role = await view(clerkRole);
    expect(role).toMatchObject({ name: 'Accueil et rendez-vous', version: 2, requiresMfa: false });
    expect(role.grants).toEqual([
      { key: 'appointment:read', scope: 'department' },
      { key: 'patient:create', scope: 'site' },
      { key: 'patient:read', scope: 'site' },
    ]);
    const effective = await tx((t) => permissions.loadPermissions(t, clerkId));
    expect([...effective].sort()).toEqual(['appointment:read', 'patient:create', 'patient:read']);
  });

  it('makes a role privileged, with the second factor, when it grants administration', async () => {
    await roles.updateRole(
      ctxFor(adminId),
      {
        roleId: clerkRole,
        name: 'Accueil et rendez-vous',
        requiresMfa: false,
        grants: [
          { key: 'patient:read', scope: 'site' },
          { key: 'user:create', scope: 'tenant' },
        ],
      },
      client,
    );
    expect(await view(clerkRole)).toMatchObject({ isPrivileged: true, requiresMfa: true });
    const events = await withSystem(handle.db, (t) =>
      t
        .select({ kind: schema.securityEvent.kind })
        .from(schema.securityEvent)
        .where(eq(schema.securityEvent.targetTenantId, tenantId)),
    );
    expect(events.map((e) => e.kind)).toContain('role_privileges_changed');
  });

  it('duplicates a role and refuses a taken code', async () => {
    const { roleId } = await roles.createRole(
      ctxFor(adminId),
      {
        code: 'accueil_soir',
        name: 'Accueil du soir',
        requiresMfa: false,
        copyFromRoleId: clerkRole,
      },
      client,
    );
    const copy = await view(roleId);
    expect(copy.templateCode).toBeNull();
    expect(copy.grants).toEqual((await view(clerkRole)).grants);
    expect(copy.isPrivileged).toBe(true);
    await expectCode(
      roles.createRole(
        ctxFor(adminId),
        { code: 'accueil_soir', name: 'Autre', requiresMfa: false },
        client,
      ),
      'ROLE_CODE_TAKEN',
    );
  });

  it('never removes role:manage from the last administrator', async () => {
    await expectCode(
      roles.updateRole(
        ctxFor(adminId),
        {
          roleId: adminRole,
          name: 'Administrateur',
          requiresMfa: true,
          grants: adminGrants.filter((g) => g.key !== 'role:manage'),
        },
        client,
      ),
      'USER_LAST_ADMIN',
    );
    expect((await view(adminRole)).grants.some((g) => g.key === 'role:manage')).toBe(true);
  });

  it('refuses unknown permissions and scopes outside the catalog, and audits every change', async () => {
    const { roleUpdateSchema } = await import('@medhub/domain');
    expect(
      roleUpdateSchema.safeParse({
        roleId: clerkRole,
        name: 'Accueil',
        requiresMfa: false,
        grants: [{ key: 'invoice:read', scope: 'warehouse' }],
      }).success,
    ).toBe(false);
    const audit = await tx((t) =>
      t
        .select({ action: schema.auditLog.action, diff: schema.auditLog.diff })
        .from(schema.auditLog)
        .orderBy(schema.auditLog.seq),
    );
    const updates = audit.filter((a) => a.action === 'role_update');
    expect(updates).toHaveLength(2);
    expect(updates[0]?.diff).toMatchObject({
      added: ['appointment:read', 'patient:create'],
      removed: ['role:read'],
      rescoped: ['patient:read'],
    });
    expect(audit.filter((a) => a.action === 'role_create')).toHaveLength(1);
    const chain = await tx((t) => verifyAuditChain(t, tenantId));
    expect(chain.ok).toBe(true);
  });
});
