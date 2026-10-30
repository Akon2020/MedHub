import { createHash } from 'node:crypto';
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
const PASSWORD = 'mot-de-passe-de-test-fictif';
const tenantId = uuidv7();
const adminId = uuidv7();
const clerkId = uuidv7();
const code = `TST-ORG-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

let handle: DbHandle;
type Core = typeof import('@/server/modules/core/service');
type Org = typeof import('@/server/modules/core/organization');
type Ctx = Parameters<Org['getOrganization']>[0];
let core: Core;
let org: Org;
let siteId: string;

function ctxFor(userId: string, mfaVerifiedAt: Date | null): Ctx {
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

describe.skipIf(!url)('organization settings against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 5).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    core = await import('@/server/modules/core/service');
    org = await import('@/server/modules/core/organization');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Structure de test organisation',
        displayName: 'Structure de test organisation',
        type: 'clinic',
        status: 'active',
      }),
    );
    const passwordHash = await hashPassword(PASSWORD);
    siteId = uuidv7();
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      const clerkRole = uuidv7();
      await tx.insert(schema.site).values({ id: siteId, tenantId, code: 'KIN', name: 'Site test' });
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'tenant_admin', name: 'Admin' },
        { id: clerkRole, tenantId, code: 'receptionist', name: 'Accueil' },
      ]);
      await tx.insert(schema.rolePermission).values(
        ['configuration:read', 'configuration:edit', 'audit:review'].map((permissionKey) => ({
          tenantId,
          roleId: adminRole,
          permissionKey,
        })),
      );
      await tx.insert(schema.userAccount).values([
        { id: adminId, tenantId, username: 'admin', displayName: 'Admin fictif', passwordHash },
        { id: clerkId, tenantId, username: 'accueil', displayName: 'Accueil fictif', passwordHash },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: clerkId, roleId: clerkRole },
      ]);
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('refuses configuration to a role without the permission', async () => {
    await expectCode(org.getOrganization(ctxFor(clerkId, new Date())), 'PERMISSION_DENIED');
    await expectCode(
      org.createSite(
        ctxFor(clerkId, new Date()),
        { code: 'LIM', name: 'Limete', address: {}, timezone: 'Africa/Kinshasa', phone: null },
        { ip },
      ),
      'PERMISSION_DENIED',
    );
  });

  it('requires a recent second factor for every change', async () => {
    const input = {
      code: 'LIM',
      name: 'Limete',
      address: {},
      timezone: 'Africa/Kinshasa' as const,
      phone: null,
    };
    await expectCode(org.createSite(ctxFor(adminId, null), input, { ip }), 'AUTH_STEP_UP_REQUIRED');
    const stale = new Date(Date.now() - 16 * 60_000);
    await expectCode(
      org.createSite(ctxFor(adminId, stale), input, { ip }),
      'AUTH_STEP_UP_REQUIRED',
    );
  });

  it('manages the profile, sites and departments with audit and business rules', async () => {
    const ctx = ctxFor(adminId, new Date());
    await org.updateTenantProfile(
      ctx,
      {
        displayName: 'Clinique fictive',
        legalName: 'Clinique fictive SARL',
        defaultLocale: 'fr',
        defaultCurrency: 'CDF',
        timezone: 'Africa/Lubumbashi',
        contact: { phone: '+243 81 000 0000', email: null, address: { city: 'Lubumbashi' } },
        legalMentions: null,
      },
      { ip },
    );
    const lim = await org.createSite(
      ctx,
      { code: 'LIM', name: 'Limete', address: {}, timezone: 'Africa/Kinshasa', phone: null },
      { ip },
    );
    await expectCode(
      org.createSite(
        ctx,
        { code: 'LIM', name: 'Doublon', address: {}, timezone: 'Africa/Kinshasa', phone: null },
        { ip },
      ),
      'ORG_SITE_CODE_TAKEN',
    );
    await org.createDepartment(
      ctx,
      {
        siteId: lim.id,
        code: 'CONS',
        name: 'Consultations',
        kind: 'clinical',
        costCenterCode: null,
      },
      { ip },
    );
    await expectCode(
      org.createDepartment(
        ctx,
        { siteId: lim.id, code: 'CONS', name: 'Doublon', kind: 'clinical', costCenterCode: null },
        { ip },
      ),
      'ORG_DEPARTMENT_CODE_TAKEN',
    );

    await org.updateSite(ctx, { id: siteId, isActive: false }, { ip });
    await expectCode(
      org.updateSite(ctx, { id: lim.id, isActive: false }, { ip }),
      'ORG_LAST_ACTIVE_SITE',
    );
    await expectCode(
      org.createDepartment(
        ctx,
        { siteId, code: 'LAB', name: 'Laboratoire', kind: 'laboratory', costCenterCode: null },
        { ip },
      ),
      'ORG_SITE_INACTIVE',
    );

    const view = await org.getOrganization(ctx);
    expect(view.tenant).toMatchObject({
      displayName: 'Clinique fictive',
      timezone: 'Africa/Lubumbashi',
      code,
    });
    expect(view.sites.map((s) => [s.code, s.isActive])).toEqual([
      ['KIN', false],
      ['LIM', true],
    ]);
    expect(view.departments).toHaveLength(1);
    expect(view.canEdit).toBe(true);

    const audit = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select({ action: schema.auditLog.action, entity: schema.auditLog.entity })
        .from(schema.auditLog),
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        { action: 'update', entity: 'tenant' },
        { action: 'create', entity: 'site' },
        { action: 'deactivate', entity: 'site' },
        { action: 'create', entity: 'department' },
      ]),
    );
    const chain = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      verifyAuditChain(tx, tenantId),
    );
    expect(chain.ok).toBe(true);
  });

  it('flags a sign-in from a new device and shows it to the administrators', async () => {
    const first = await core.login({
      tenantCode: code,
      username: 'accueil',
      password: PASSWORD,
      ip,
      userAgent: WINDOWS,
    });
    const again = await core.login({
      tenantCode: code,
      username: 'accueil',
      password: PASSWORD,
      ip,
      userAgent: WINDOWS,
    });
    const phone = await core.login({
      tenantCode: code,
      username: 'accueil',
      password: PASSWORD,
      ip,
      userAgent: ANDROID,
    });
    expect([first.status, again.status, phone.status]).toEqual([
      'signed_in',
      'signed_in',
      'signed_in',
    ]);

    const events = await org.listSecurityEvents(ctxFor(adminId, null));
    const anomalies = events.filter((e) => e.kind === 'sign_in_anomaly');
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      user: 'Accueil fictif',
      detail: { anomalies: ['new_device'], device: 'Chrome · Android' },
    });
    await expectCode(org.listSecurityEvents(ctxFor(clerkId, null)), 'PERMISSION_DENIED');
  });

  it('rotates the session identifier when the second factor is proven again', async () => {
    // A real session, so that rotation has something to revoke.
    const signed = await core.login({
      tenantCode: code,
      username: 'admin',
      password: PASSWORD,
      ip,
      userAgent: WINDOWS,
    });
    expect(signed.status).toBe('signed_in');
    const [current] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, adminId))
        .orderBy(schema.session.createdAt),
    );
    if (!current) throw new Error('no session');
    // Without a second factor configured, step-up is impossible.
    await expectCode(
      core.stepUp({ ...ctxFor(adminId, null), sessionId: current.id }, '123456', {
        ip,
        userAgent: WINDOWS,
      }),
      'AUTH_MFA_NOT_ENROLLED',
    );

    const { generate } = await import('otplib');
    const material = await core.beginMfaSetup({ ...ctxFor(adminId, null), sessionId: current.id });
    const confirmed = await core.confirmMfaSetup(
      { ...ctxFor(adminId, null), sessionId: current.id },
      await generate({ secret: material.secret }),
      { ip, userAgent: WINDOWS },
    );
    const token = confirmed.session.cookie.split('.')[1] as string;
    const sessions = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.session).where(eq(schema.session.userId, adminId)),
    );
    const old = sessions.find((s) => s.id === current.id);
    const rotated = sessions.find(
      (s) => s.tokenHash === createHash('sha256').update(token).digest('hex'),
    );
    expect(old?.revokedAt).not.toBeNull();
    expect(rotated).toMatchObject({ rotatedFrom: current.id, revokedAt: null });
    expect(rotated?.mfaVerifiedAt).not.toBeNull();
  });
});
