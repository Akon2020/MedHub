import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { hashPassword } from '@medhub/db/password';
import { isAppError, uuidv7 } from '@medhub/shared';
import { bytesToBase64, generateDeviceKeyPair, verifyToken } from '@medhub/sync';
import { ed25519 } from '@noble/curves/ed25519.js';
import { config } from 'dotenv';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const PASSWORD = 'mot-de-passe-de-test-fictif';
const tenantId = uuidv7();
const adminId = uuidv7();
const nurseId = uuidv7();
const code = `TST-DEV-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const client = { ip: `192.0.2.${Math.floor(Math.random() * 250) + 1}`, userAgent: 'vitest' };

let handle: DbHandle;
type Core = typeof import('@/server/modules/core/service');
type Devices = typeof import('@/server/modules/core/devices');
type Sync = typeof import('@/server/modules/sync/service');
type Session = typeof import('@/server/platform/session');
type Ctx = Parameters<Devices['listDevices']>[0];
let core: Core;
let devices: Devices;
let sync: Sync;
let session: Session;

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) ? error.code : error).toBe(expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

/** Signs the nurse in and returns a context bound to the real session row. */
async function nurseSession(): Promise<{ ctx: Ctx; cookie: string }> {
  const result = await core.login({
    tenantCode: code,
    username: 'infirmier',
    password: PASSWORD,
    ...client,
  });
  if (result.status !== 'signed_in') throw new Error('sign-in failed');
  const found = await session.lookupSession(result.cookie);
  if (!found) throw new Error('no session');
  return { ctx: { ...found, sessionId: found.sessionId }, cookie: result.cookie };
}

function adminCtx(): Ctx {
  return {
    tenantId,
    userId: adminId,
    sessionId: uuidv7(),
    deviceId: null,
    mfaVerifiedAt: new Date(),
  };
}

async function register(ctx: Ctx) {
  const keys = generateDeviceKeyPair();
  return core.registerDevice(ctx, {
    publicKey: bytesToBase64(keys.publicKey),
    name: 'Poste test',
    kind: 'tablet',
    userAgent: 'vitest',
    appVersion: '0.1.0',
  });
}

describe.skipIf(!url)('device lifecycle against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    if (!process.env.MEDHUB_SIGNING_PRIVATE_KEY) {
      const secret = ed25519.utils.randomSecretKey();
      process.env.MEDHUB_SIGNING_KID = 'ktest';
      process.env.MEDHUB_SIGNING_PRIVATE_KEY = bytesToBase64(secret);
      process.env.MEDHUB_SIGNING_PUBLIC_KEY = bytesToBase64(ed25519.getPublicKey(secret));
    }
    core = await import('@/server/modules/core/service');
    devices = await import('@/server/modules/core/devices');
    sync = await import('@/server/modules/sync/service');
    session = await import('@/server/platform/session');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Structure de test appareils',
        displayName: 'Structure de test appareils',
        type: 'clinic',
        status: 'active',
      }),
    );
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      const nurseRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'tenant_admin', name: 'Admin' },
        { id: nurseRole, tenantId, code: 'nurse', name: 'Infirmier' },
      ]);
      await tx.insert(schema.rolePermission).values([
        ...['device:read', 'device:revoke'].map((permissionKey) => ({
          tenantId,
          roleId: adminRole,
          permissionKey,
        })),
        ...['device:register', 'patient:read'].map((permissionKey) => ({
          tenantId,
          roleId: nurseRole,
          permissionKey,
        })),
      ]);
      await tx.insert(schema.userAccount).values([
        { id: adminId, tenantId, username: 'admin', displayName: 'Admin fictif', passwordHash },
        {
          id: nurseId,
          tenantId,
          username: 'infirmier',
          displayName: 'Infirmier fictif',
          passwordHash,
        },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: nurseId, roleId: nurseRole },
      ]);
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('issues signed offline and license tokens at registration and on renewal', async () => {
    const { ctx } = await nurseSession();
    const device = await register(ctx);
    const offline = verifyToken(device.tokens.offlineToken, device.tokens.signingKeys, 'offline');
    expect(offline).toMatchObject({ sub: nurseId, tid: tenantId, did: device.deviceId });
    expect((offline?.exp ?? 0) - (offline?.iat ?? 0)).toBe(14 * 86_400);
    const license = verifyToken(device.tokens.licenseToken, device.tokens.signingKeys, 'license');
    expect(license).toMatchObject({ tid: tenantId, state: 'active', plan: null });
    expect(license?.modules).toContain('pat');
    const renewed = await core.refreshDeviceTokens(ctx, device.deviceId);
    expect(verifyToken(renewed.offlineToken, renewed.signingKeys, 'offline')).not.toBeNull();
  });

  it('lets a retired device send a final push, then refuses it and ends its sessions', async () => {
    const { ctx, cookie } = await nurseSession();
    const device = await register(ctx);
    const deviceCtx = { ...ctx, deviceId: device.deviceId };
    await expectCode(
      devices.revokeDevice(
        { ...adminCtx(), mfaVerifiedAt: null },
        { deviceId: device.deviceId, status: 'revoked', reason: 'Remplacé', allowFinalPush: true },
        client,
      ),
      'AUTH_STEP_UP_REQUIRED',
    );
    await devices.revokeDevice(
      adminCtx(),
      { deviceId: device.deviceId, status: 'revoked', reason: 'Remplacé', allowFinalPush: true },
      client,
    );
    // Final push accepted, sessions still open.
    const pushed = await sync.push(
      deviceCtx,
      { deviceId: device.deviceId, schemaVersion: 1, ops: [] },
      10,
    );
    expect(pushed.results).toEqual([]);
    expect(await session.lookupSession(cookie)).not.toBeNull();
    // Any other contact: DEVICE_REVOKED, sessions ended, and the cookie now says so.
    await expectCode(
      sync.pull(deviceCtx, { deviceId: device.deviceId, cursor: 0, limit: 10, lookback: false }),
      'DEVICE_REVOKED',
    );
    expect(await session.lookupSession(cookie)).toBeNull();
    expect(await session.sessionDeviceRevoked(cookie)).toBe(true);
    await expectCode(core.refreshDeviceTokens(ctx, device.deviceId), 'DEVICE_REVOKED');
  });

  it('cuts a lost device off at once, final push included', async () => {
    const { ctx, cookie } = await nurseSession();
    const device = await register(ctx);
    await devices.revokeDevice(
      adminCtx(),
      {
        deviceId: device.deviceId,
        status: 'lost',
        reason: 'Volé à la caisse',
        allowFinalPush: true,
      },
      client,
    );
    expect(await session.lookupSession(cookie)).toBeNull();
    await expectCode(
      sync.push(
        { ...ctx, deviceId: device.deviceId },
        { deviceId: device.deviceId, schemaVersion: 1, ops: [] },
        10,
      ),
      'DEVICE_REVOKED',
    );
    const [row] = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.device).where(eq(schema.device.id, device.deviceId)),
    );
    expect(row).toMatchObject({ status: 'lost', allowFinalPush: false, revokedBy: adminId });
    await expectCode(
      devices.revokeDevice(
        adminCtx(),
        { deviceId: device.deviceId, status: 'revoked', reason: 'Encore', allowFinalPush: false },
        client,
      ),
      'DEVICE_ALREADY_REVOKED',
    );
  });

  it('lists devices for administrators only and records security events', async () => {
    const list = await devices.listDevices(adminCtx());
    expect(list.map((d) => d.status).sort()).toEqual(['active', 'lost', 'revoked']);
    const { ctx } = await nurseSession();
    await expectCode(devices.listDevices(ctx), 'PERMISSION_DENIED');
    const events = await withSystem(handle.db, (tx) =>
      tx
        .select()
        .from(schema.securityEvent)
        .where(eq(schema.securityEvent.targetTenantId, tenantId)),
    );
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['device_revoked', 'device_lost']),
    );
    const open = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx
        .select()
        .from(schema.session)
        .where(and(eq(schema.session.userId, nurseId), isNull(schema.session.revokedAt))),
    );
    expect(open.length).toBeGreaterThan(0);
  });
});
