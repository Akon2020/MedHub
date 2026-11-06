import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const adminId = uuidv7();
const nurseId = uuidv7();
const client = { ip: null };

let handle: DbHandle;
type Dpi = typeof import('@/server/modules/dpi/config');
type Reference = typeof import('@/server/modules/core/reference');
let dpi: Dpi;
let reference: Reference;

const ctxFor = (userId: string) => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});

describe.skipIf(!url)('vital sign settings against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 17).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    dpi = await import('@/server/modules/dpi/config');
    reference = await import('@/server/modules/core/reference');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-VSD-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test constantes',
        displayName: 'Structure de test constantes',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const adminRole = uuidv7();
      const nurseRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: adminRole, tenantId, code: 'admin', name: 'Admin' },
        { id: nurseRole, tenantId, code: 'nurse', name: 'Infirmier' },
      ]);
      await tx.insert(schema.rolePermission).values([
        { tenantId, roleId: adminRole, permissionKey: 'configuration:read' },
        { tenantId, roleId: adminRole, permissionKey: 'configuration:edit' },
      ]);
      await tx.insert(schema.userAccount).values([
        { id: adminId, tenantId, username: 'admin', displayName: 'Admin', passwordHash: 'x' },
        { id: nurseId, tenantId, username: 'inf', displayName: 'Infirmier', passwordHash: 'x' },
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

  it('keeps built-in plausibility, no normal range until the structure sets one', async () => {
    const before = await dpi.getVitalDefinitions(ctxFor(adminId));
    const pulse = before.definitions.find((d) => d.code === 'pulse');
    expect(pulse).toMatchObject({ plausibleMin: 20, normalRanges: [], configured: false });

    try {
      await dpi.saveVitalDefinition(
        ctxFor(nurseId),
        { code: 'pulse', plausibleMin: 20, plausibleMax: 250, normalRanges: [] },
        client,
      );
      throw new Error('expected PERMISSION_DENIED');
    } catch (error) {
      expect(isAppError(error) ? error.code : error).toBe('PERMISSION_DENIED');
    }

    await dpi.saveVitalDefinition(
      ctxFor(adminId),
      {
        code: 'pulse',
        plausibleMin: 25,
        plausibleMax: 250,
        stabilityMargin: 5,
        normalRanges: [{ ageMinYears: 18, ageMaxYears: 130, low: 50, high: 100 }],
      },
      client,
    );
    const snapshot = await reference.catalogSnapshot(ctxFor(nurseId));
    expect(snapshot.vitalDefinitions?.find((d) => d.code === 'pulse')).toMatchObject({
      plausibleMin: 25,
      stabilityMargin: 5,
      normalRanges: [{ low: 50, high: 100 }],
    });
    expect(snapshot.vitalDefinitions?.find((d) => d.code === 'temp')?.normalRanges).toEqual([]);
  });
});
