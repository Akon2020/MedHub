import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { isAppError, uuidv7 } from '@medhub/shared';
import { bytesToBase64, generateDeviceKeyPair, verifyToken } from '@medhub/sync';
import { ed25519 } from '@noble/curves/ed25519.js';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const adminId = uuidv7();
const editorId = uuidv7();
const code = `TST-CFG-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const KEY = 'security.offline_token_days' as const;

let handle: DbHandle;
type Configuration = typeof import('@/server/modules/core/configuration');
type Core = typeof import('@/server/modules/core/service');
type Ctx = Parameters<Configuration['getConfiguration']>[0];
let cfg: Configuration;
let core: Core;

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

async function item(key: string) {
  const view = await cfg.getConfiguration(ctxFor(adminId));
  const found = view.items.find((i) => i.key === key);
  if (!found) throw new Error(key);
  return found;
}

describe.skipIf(!url)('versioned configuration against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 4).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    if (!process.env.MEDHUB_SIGNING_PRIVATE_KEY) {
      const secret = ed25519.utils.randomSecretKey();
      process.env.MEDHUB_SIGNING_KID = 'ktest';
      process.env.MEDHUB_SIGNING_PRIVATE_KEY = bytesToBase64(secret);
      process.env.MEDHUB_SIGNING_PUBLIC_KEY = bytesToBase64(ed25519.getPublicKey(secret));
    }
    cfg = await import('@/server/modules/core/configuration');
    core = await import('@/server/modules/core/service');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Structure de test configuration',
        displayName: 'Structure de test configuration',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      const editorRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'tenant_admin', name: 'Admin' },
        { id: editorRole, tenantId, code: 'config_editor', name: 'Rédacteur' },
      ]);
      await tx.insert(schema.rolePermission).values([
        ...[
          'configuration:read',
          'configuration:edit',
          'configuration:publish',
          'device:register',
        ].map((permissionKey) => ({ tenantId, roleId: adminRole, permissionKey })),
        ...['configuration:read', 'configuration:edit'].map((permissionKey) => ({
          tenantId,
          roleId: editorRole,
          permissionKey,
        })),
      ]);
      await tx.insert(schema.userAccount).values([
        {
          id: adminId,
          tenantId,
          username: 'admin',
          displayName: 'Admin fictif',
          passwordHash: 'x',
        },
        {
          id: editorId,
          tenantId,
          username: 'redacteur',
          displayName: 'Rédacteur fictif',
          passwordHash: 'x',
        },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: editorId, roleId: editorRole },
      ]);
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('starts from the documented defaults', async () => {
    expect(await item(KEY)).toMatchObject({ default: 14, published: null, draft: null });
  });

  it('validates drafts and separates editing from publishing', async () => {
    await expectCode(cfg.saveDraft(ctxFor(adminId), { key: KEY, value: 45 }), 'VALIDATION_FAILED');
    await expectCode(
      cfg.saveDraft(ctxFor(adminId, null), { key: KEY, value: 7 }),
      'AUTH_STEP_UP_REQUIRED',
    );
    await cfg.saveDraft(ctxFor(editorId), { key: KEY, value: 7 });
    await cfg.saveDraft(ctxFor(editorId), { key: KEY, value: 10 });
    expect((await item(KEY)).draft).toMatchObject({ version: 1, value: 10 });
    await expectCode(cfg.publishDraft(ctxFor(editorId), KEY, { ip: null }), 'PERMISSION_DENIED');
  });

  it('publishes, archives the previous version and never changes a published one', async () => {
    await cfg.publishDraft(ctxFor(adminId), KEY, { ip: null });
    await cfg.saveDraft(ctxFor(adminId), { key: KEY, value: 21 });
    await cfg.publishDraft(ctxFor(adminId), KEY, { ip: null });
    const current = await item(KEY);
    expect(current.published).toMatchObject({ version: 2, value: 21 });
    expect(current.history.map((v) => [v.version, v.status])).toEqual([
      [2, 'published'],
      [1, 'archived'],
    ]);

    await expect(
      withTenant(handle.db, { tenantId, userId: null }, (tx) =>
        tx
          .update(schema.configEntry)
          .set({ value: 30 })
          .where(and(eq(schema.configEntry.key, KEY), eq(schema.configEntry.version, 2))),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(handle.db, { tenantId, userId: null }, (tx) =>
        tx
          .delete(schema.configEntry)
          .where(and(eq(schema.configEntry.key, KEY), eq(schema.configEntry.version, 1))),
      ),
    ).rejects.toThrow();
  });

  it('restores an old value as a new draft, and discards drafts', async () => {
    await cfg.restoreVersion(ctxFor(adminId), KEY, 1);
    expect((await item(KEY)).draft).toMatchObject({ version: 3, value: 10, note: 'restore:1' });
    await cfg.discardDraft(ctxFor(adminId), KEY);
    expect((await item(KEY)).draft).toBeNull();
  });

  it('applies published values: offline token length and step-up window', async () => {
    const result = await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const values = await cfg.loadConfig(tx);
      return values;
    });
    expect(result['security.offline_token_days']).toBe(21);

    const session = uuidv7();
    await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.insert(schema.session).values({
        id: session,
        tenantId,
        userId: adminId,
        tokenHash: uuidv7(),
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
    const keys = generateDeviceKeyPair();
    const device = await core.registerDevice(
      { ...ctxFor(adminId), sessionId: session },
      {
        publicKey: bytesToBase64(keys.publicKey),
        name: 'Poste',
        kind: 'desktop',
        userAgent: null,
        appVersion: null,
      },
    );
    const offline = verifyToken(device.tokens.offlineToken, device.tokens.signingKeys, 'offline');
    expect((offline?.exp ?? 0) - (offline?.iat ?? 0)).toBe(21 * 86_400);
    expect(device.tokens.config).toEqual({
      autoLockMinutes: 5,
      pinMaxAttempts: 10,
      duplicateAlertScore: 50,
    });

    await cfg.saveDraft(ctxFor(adminId), { key: 'security.step_up_minutes', value: 5 });
    await cfg.publishDraft(ctxFor(adminId), 'security.step_up_minutes', { ip: null });
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    await expectCode(
      cfg.saveDraft(ctxFor(adminId, tenMinutesAgo), { key: KEY, value: 3 }),
      'AUTH_STEP_UP_REQUIRED',
    );

    const audit = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select({ action: schema.auditLog.action }).from(schema.auditLog),
    );
    expect(audit.filter((a) => a.action === 'config_publish')).toHaveLength(3);
    const chain = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      verifyAuditChain(tx, tenantId),
    );
    expect(chain.ok).toBe(true);
  });
});
