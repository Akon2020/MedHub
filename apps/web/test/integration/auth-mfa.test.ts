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
import { generate } from 'otplib';
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
const code = `TST-MFA-${String(Math.floor(Math.random() * 9000) + 1000)}`;
// A documentation range address per run, so that rate limit windows never collide.
const client = { ip: `203.0.113.${Math.floor(Math.random() * 250) + 1}`, userAgent: 'vitest' };
let handle: DbHandle;
type Service = typeof import('@/server/modules/core/service');
let service: Service;

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) ? error.code : error).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

/** Waits for the next 30 s TOTP window, so that a fresh code is not a replay. */
async function nextWindowCode(secret: string): Promise<string> {
  const wait = 30_000 - (Date.now() % 30_000) + 200;
  await new Promise((r) => setTimeout(r, wait));
  return generate({ secret });
}

describe.skipIf(!url)('two-factor sign-in against PostgreSQL', () => {
  beforeAll(async () => {
    // The services read DATABASE_URL lazily: point them at the test database.
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 3).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    service = await import('@/server/modules/core/service');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Structure de test 2FA',
        displayName: 'Structure de test 2FA',
        type: 'clinic',
        status: 'active',
      }),
    );
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      const clerkRole = uuidv7();
      await tx.insert(schema.role).values([
        {
          id: adminRole,
          tenantId,
          code: 'tenant_admin',
          name: 'Admin',
          isPrivileged: true,
          requiresMfa: true,
        },
        { id: clerkRole, tenantId, code: 'receptionist', name: 'Accueil' },
      ]);
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

  it('signs a non-privileged role in with the password alone', async () => {
    const result = await service.login({
      tenantCode: code,
      username: 'accueil',
      password: PASSWORD,
      ...client,
    });
    expect(result.status).toBe('signed_in');
  });

  it(
    'imposes enrollment on a privileged role, then requires the second factor',
    { timeout: 90_000 },
    async () => {
      const first = await service.login({
        tenantCode: code,
        username: 'admin',
        password: PASSWORD,
        ...client,
      });
      expect(first.status).toBe('mfa_enrollment_required');
      if (first.status !== 'mfa_enrollment_required') return;

      const material = await service.startEnrollment({ challenge: first.challenge, ...client });
      expect(material.uri).toMatch(/^otpauth:\/\/totp\//);
      expect(material.qrSvg).toContain('<svg');
      await expectCode(
        service.completeEnrollment({ challenge: first.challenge, code: '000000', ...client }),
        'AUTH_MFA_INVALID',
      );
      const enrolled = await service.completeEnrollment({
        challenge: first.challenge,
        code: await generate({ secret: material.secret }),
        ...client,
      });
      expect(enrolled.status).toBe('signed_in');
      expect(enrolled.recoveryCodes).toHaveLength(10);

      const stored = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
        tx.select().from(schema.userAccount).where(eq(schema.userAccount.id, adminId)),
      );
      expect(stored[0]?.mfaSecretEnc).not.toContain(material.secret);
      expect(stored[0]?.mfaEnabledAt).not.toBeNull();

      // A challenge from the password step is not a session and expires on its own.
      const second = await service.login({
        tenantCode: code,
        username: 'admin',
        password: PASSWORD,
        ...client,
      });
      expect(second.status).toBe('mfa_required');
      if (second.status !== 'mfa_required') return;
      await expectCode(
        service.startEnrollment({ challenge: second.challenge, ...client }),
        'AUTH_MFA_CHALLENGE_EXPIRED',
      );

      const fresh = await nextWindowCode(material.secret);
      const verified = await service.verifyMfa({
        challenge: second.challenge,
        code: fresh,
        ...client,
      });
      expect(verified.status).toBe('signed_in');
      // The same code cannot be replayed.
      await expectCode(
        service.verifyMfa({ challenge: second.challenge, code: fresh, ...client }),
        'AUTH_MFA_INVALID',
      );

      const recovery = enrolled.recoveryCodes[0] as string;
      const viaRecovery = await service.verifyMfa({
        challenge: second.challenge,
        code: recovery.toLowerCase(),
        ...client,
      });
      expect(viaRecovery.status).toBe('signed_in');
      await expectCode(
        service.verifyMfa({ challenge: second.challenge, code: recovery, ...client }),
        'AUTH_MFA_INVALID',
      );

      const ctx = {
        tenantId,
        userId: adminId,
        sessionId: uuidv7(),
        deviceId: null,
        mfaVerifiedAt: new Date(),
      };
      const overview = await service.securityOverview(ctx);
      expect(overview.mfa).toMatchObject({
        enabled: true,
        requiredByRole: true,
        recoveryCodesLeft: 9,
      });
      await expectCode(
        service.disableMfa(ctx, enrolled.recoveryCodes[1] as string, client),
        'AUTH_MFA_REQUIRED_BY_ROLE',
      );
    },
  );

  it('keeps the audit chain intact through every step', async () => {
    const result = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      verifyAuditChain(tx, tenantId),
    );
    expect(result.ok).toBe(true);
    const actions = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select({ action: schema.auditLog.action }).from(schema.auditLog),
    );
    const names = actions.map((a) => a.action);
    expect(names).toEqual(expect.arrayContaining(['login', 'mfa_failed', 'mfa_enabled']));
  });

  it('refuses beyond the rate limit and records a security event', async () => {
    const { enforceRateLimit } = await import('@/server/platform/security');
    const rule = { name: `test-${uuidv7()}`, limit: 2, windowSeconds: 60 };
    await enforceRateLimit(rule, 'subject', { ip: null, tenantId });
    await enforceRateLimit(rule, 'subject', { ip: null, tenantId });
    await expectCode(enforceRateLimit(rule, 'subject', { ip: null, tenantId }), 'RATE_LIMITED');
    const events = await withSystem(handle.db, (tx) =>
      tx
        .select()
        .from(schema.securityEvent)
        .where(eq(schema.securityEvent.targetTenantId, tenantId)),
    );
    expect(events.some((e) => e.kind === 'rate_limited')).toBe(true);
  });
});
