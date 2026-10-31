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
import { TRAINING_PATIENT_COUNT } from '@medhub/domain';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const letters = () =>
  Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
    '',
  );
const code = `TST-${letters()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const trainingCode = `FOR${code.slice(3)}`;
const tenantId = uuidv7();
const adminId = uuidv7();
const nurseId = uuidv7();
const PASSWORD = 'phrase de test pour la formation';
const client = { ip: '203.0.113.50', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' };

let handle: DbHandle;
type Training = typeof import('@/server/modules/core/training');
type Core = typeof import('@/server/modules/core/service');
type Ctx = Parameters<Training['getTraining']>[0];
let training: Training;
let core: Core;
let totpSecret = '';

function ctxFor(userId: string, mfaVerifiedAt: Date | null = new Date(), tenant = tenantId): Ctx {
  return { tenantId: tenant, userId, sessionId: uuidv7(), deviceId: null, mfaVerifiedAt };
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

async function tenantsWithCode(value: string) {
  return withSystem(handle.db, (tx) =>
    tx.select().from(schema.tenant).where(eq(schema.tenant.code, value)),
  );
}

describe.skipIf(!url)('training base against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 8).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    training = await import('@/server/modules/core/training');
    core = await import('@/server/modules/core/service');
    const mfa = await import('@/server/platform/mfa');
    handle = createDb(url as string, 4);
    totpSecret = mfa.newTotpSecret();
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code,
        legalName: 'Clinique de test formation',
        displayName: 'Clinique de test formation',
        type: 'clinic',
        status: 'active',
      }),
    );
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const siteId = uuidv7();
      const adminRole = uuidv7();
      const nurseRole = uuidv7();
      await tx.insert(schema.site).values({ id: siteId, tenantId, code: 'KIN', name: 'Site' });
      await tx.insert(schema.department).values({
        id: uuidv7(),
        tenantId,
        siteId,
        code: 'CONS',
        name: 'Consultations',
        kind: 'clinical',
      });
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'tenant_admin', name: 'Administrateur' },
        { id: nurseRole, tenantId, code: 'nurse', name: 'Infirmier', requiresMfa: true },
      ]);
      await tx.insert(schema.rolePermission).values([
        ...['configuration:read', 'configuration:publish', 'patient:read'].map((key) => ({
          tenantId,
          roleId: adminRole,
          permissionKey: key,
        })),
        { tenantId, roleId: nurseRole, permissionKey: 'patient:read' },
      ]);
      await tx.insert(schema.userAccount).values([
        {
          id: adminId,
          tenantId,
          username: 'admin',
          displayName: 'Admin fictif',
          passwordHash,
          defaultSiteId: siteId,
        },
        {
          id: nurseId,
          tenantId,
          username: 'infirmier',
          displayName: 'Infirmier fictif',
          passwordHash,
          mfaSecretEnc: mfa.sealSecret(tenantId, totpSecret),
          mfaEnabledAt: new Date(),
        },
        {
          id: uuidv7(),
          tenantId,
          username: 'ancien',
          displayName: 'Compte désactivé',
          passwordHash,
          status: 'disabled',
        },
      ]);
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: adminId, roleId: adminRole },
        { id: uuidv7(), tenantId, userId: nurseId, roleId: nurseRole },
      ]);
      await tx.insert(schema.configEntry).values({
        id: uuidv7(),
        tenantId,
        domain: 'security',
        key: 'security.auto_lock_minutes',
        version: 1,
        status: 'published',
        value: 9,
        publishedAt: new Date(),
      });
      const listId = uuidv7();
      await tx
        .insert(schema.choiceList)
        .values({ id: listId, tenantId, code: 'ARRIVEE', nameFr: 'Arrivée' });
      await tx
        .insert(schema.choiceItem)
        .values({ id: uuidv7(), tenantId, listId, code: 'PIED', labelFr: 'À pied' });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('is reserved to configuration:publish with a recent second factor', async () => {
    expect((await training.getTraining(ctxFor(adminId, null))).training).toBeNull();
    await expectCode(
      training.buildTraining(ctxFor(adminId, null), 'create', client),
      'AUTH_STEP_UP_REQUIRED',
    );
    await expectCode(
      training.buildTraining(ctxFor(nurseId), 'create', client),
      'PERMISSION_DENIED',
    );
  });

  it('copies configuration, roles and active users, and adds fictitious patients', async () => {
    expect(await training.buildTraining(ctxFor(adminId), 'create', client)).toEqual({
      code: trainingCode,
    });
    const view = await training.getTraining(ctxFor(adminId, null));
    expect(view.training).toMatchObject({
      code: trainingCode,
      status: 'active',
      users: 2,
      patients: TRAINING_PATIENT_COUNT,
    });
    const [copy] = await tenantsWithCode(trainingCode);
    expect(copy).toMatchObject({ isTraining: true, trainingSourceId: tenantId });
    const copyId = copy?.id ?? '';
    await withTenant(handle.db, { tenantId: copyId, userId: null }, async (tx) => {
      expect(await tx.select().from(schema.department)).toHaveLength(1);
      expect(await tx.select().from(schema.choiceItem)).toHaveLength(1);
      const [entry] = await tx.select().from(schema.configEntry);
      expect(entry).toMatchObject({
        key: 'security.auto_lock_minutes',
        value: 9,
        status: 'published',
      });
      const changes = await tx
        .select()
        .from(schema.changeLog)
        .where(eq(schema.changeLog.entity, 'patient'));
      expect(changes).toHaveLength(TRAINING_PATIENT_COUNT);
      const patients = await tx.select().from(schema.patient);
      expect(patients.every((p) => p.phone === null && p.mrn.startsWith('FOR-'))).toBe(true);
    });
    await expectCode(
      training.buildTraining(ctxFor(adminId), 'create', client),
      'TRAINING_ALREADY_EXISTS',
    );
  });

  it('signs users in to the training code with their usual password and second factor', async () => {
    const admin = await core.login({
      tenantCode: trainingCode,
      username: 'admin',
      password: PASSWORD,
      ...client,
    });
    expect(admin.status).toBe('signed_in');
    if (admin.status === 'signed_in') expect(admin.profile.tenant.isTraining).toBe(true);

    const nurse = await core.login({
      tenantCode: trainingCode,
      username: 'infirmier',
      password: PASSWORD,
      ...client,
    });
    expect(nurse.status).toBe('mfa_required');
    if (nurse.status !== 'mfa_required') return;
    const signedIn = await core.verifyMfa({
      challenge: nurse.challenge,
      code: await generate({ secret: totpSecret }),
      ...client,
    });
    expect(signedIn.profile.tenant.code).toBe(trainingCode);
    await expectCode(
      core.login({ tenantCode: trainingCode, username: 'ancien', password: PASSWORD, ...client }),
      'AUTH_INVALID_CREDENTIALS',
    );
  });

  it('resets by archiving the previous base, whose devices are cut off, under the same code', async () => {
    const [before] = await tenantsWithCode(trainingCode);
    const oldId = before?.id ?? '';
    const deviceId = uuidv7();
    await withTenant(handle.db, { tenantId: oldId, userId: null }, (tx) =>
      tx.insert(schema.device).values({
        id: deviceId,
        tenantId: oldId,
        userId: uuidv7(),
        deviceCode: 'AA',
        name: 'Tablette de formation',
        kind: 'tablet',
        publicKey: 'test',
      }),
    );
    await training.buildTraining(ctxFor(adminId), 'reset', client);
    const all = await tenantsWithCode(trainingCode);
    expect(all.map((t) => t.status).sort()).toEqual(['active', 'archived']);
    expect(all.find((t) => t.id === oldId)?.status).toBe('archived');
    const [device] = await withTenant(handle.db, { tenantId: oldId, userId: null }, (tx) =>
      tx.select().from(schema.device).where(eq(schema.device.id, deviceId)),
    );
    expect(device?.status).toBe('revoked');
    const signedIn = await core.login({
      tenantCode: trainingCode,
      username: 'admin',
      password: PASSWORD,
      ...client,
    });
    expect(signedIn.status === 'signed_in' && signedIn.profile.tenant.id).not.toBe(oldId);
    expect((await training.getTraining(ctxFor(adminId, null))).archived).toBe(1);
  });

  it('cannot be nested, and audits every step in valid chains', async () => {
    const [active] = await withSystem(handle.db, (tx) =>
      tx
        .select()
        .from(schema.tenant)
        .where(and(eq(schema.tenant.code, trainingCode), eq(schema.tenant.status, 'active'))),
    );
    const trainingId = active?.id ?? '';
    const [trainingAdmin] = await withTenant(
      handle.db,
      { tenantId: trainingId, userId: null },
      (tx) => tx.select().from(schema.userAccount).where(eq(schema.userAccount.username, 'admin')),
    );
    await expectCode(
      training.buildTraining(
        ctxFor(trainingAdmin?.id ?? '', new Date(), trainingId),
        'create',
        client,
      ),
      'TRAINING_NOT_ALLOWED',
    );
    const actions = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select({ action: schema.auditLog.action }).from(schema.auditLog),
    );
    expect(actions.map((a) => a.action)).toEqual(['training_create', 'training_reset']);
    for (const id of [tenantId, trainingId]) {
      const chain = await withTenant(handle.db, { tenantId: id, userId: null }, (tx) =>
        verifyAuditChain(tx, id),
      );
      expect(chain.ok).toBe(true);
    }
  });
});
