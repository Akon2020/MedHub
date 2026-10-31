import { resolve } from 'node:path';
import {
  createDb,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type DbHandle,
} from '@medhub/db';
import { patientSearchFields } from '@medhub/domain';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const reviewerId = uuidv7();
const clerkId = uuidv7();
const client = { ip: '203.0.113.60' };

let handle: DbHandle;
type Duplicates = typeof import('@/server/modules/pat/duplicates');
type Ctx = Parameters<Duplicates['listDuplicates']>[0];
let duplicates: Duplicates;
let candidateId = '';

function ctxFor(userId: string): Ctx {
  return { tenantId, userId, sessionId: uuidv7(), deviceId: null, mfaVerifiedAt: null };
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

describe.skipIf(!url)('duplicates queue against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    duplicates = await import('@/server/modules/pat/duplicates');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-DQU-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test file des doublons',
        displayName: 'Structure de test file des doublons',
        type: 'clinic',
        status: 'active',
      }),
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const reviewerRole = uuidv7();
      const clerkRole = uuidv7();
      await tx.insert(schema.role).values([
        { id: reviewerRole, tenantId, code: 'reviewer', name: 'Revue' },
        { id: clerkRole, tenantId, code: 'receptionist', name: 'Accueil' },
      ]);
      await tx.insert(schema.rolePermission).values([
        { tenantId, roleId: reviewerRole, permissionKey: 'patient:merge' },
        { tenantId, roleId: clerkRole, permissionKey: 'patient:read' },
      ]);
      await tx.insert(schema.userAccount).values([
        {
          id: reviewerId,
          tenantId,
          username: 'revue',
          displayName: 'Revue fictive',
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
      await tx.insert(schema.userRole).values([
        { id: uuidv7(), tenantId, userId: reviewerId, roleId: reviewerRole },
        { id: uuidv7(), tenantId, userId: clerkId, roleId: clerkRole },
      ]);
      const ids = [uuidv7(), uuidv7()].sort();
      for (const [i, id] of ids.entries()) {
        const person = { familyName: 'Kabila', givenName: 'Jean', phone: '0991234567' };
        await tx.insert(schema.patient).values({
          id,
          tenantId,
          mrn: `TST-${i}`,
          ...person,
          sex: 'M',
          birthDate: i === 0 ? '1990-03-12' : '1990-01-01',
          birthDateEstimated: i === 1,
          ...patientSearchFields(person),
        });
      }
      candidateId = uuidv7();
      await tx.insert(schema.duplicateCandidate).values({
        id: candidateId,
        tenantId,
        patientAId: ids[0] ?? '',
        patientBId: ids[1] ?? '',
        score: 95,
        reasons: ['phonetic', 'name_similar', 'birth_year', 'phone'],
      });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('shows open pairs side by side to patient:merge only', async () => {
    await expectCode(duplicates.listDuplicates(ctxFor(clerkId)), 'PERMISSION_DENIED');
    const { pairs } = await duplicates.listDuplicates(ctxFor(reviewerId));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ id: candidateId, score: 95 });
    expect([pairs[0]?.a.birthDate, pairs[0]?.b.birthDate].sort()).toEqual([
      '1990-01-01',
      '1990-03-12',
    ]);
  });

  it('dismisses a pair with a reason, once, and audits it', async () => {
    await expectCode(
      duplicates.dismissDuplicate(ctxFor(clerkId), { candidateId, reason: 'Homonymes' }, client),
      'PERMISSION_DENIED',
    );
    await duplicates.dismissDuplicate(
      ctxFor(reviewerId),
      { candidateId, reason: 'Homonymes, parents différents' },
      client,
    );
    expect((await duplicates.listDuplicates(ctxFor(reviewerId))).pairs).toEqual([]);
    await expectCode(
      duplicates.dismissDuplicate(ctxFor(reviewerId), { candidateId, reason: 'Encore' }, client),
      'NOT_FOUND',
    );
    await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
      const [row] = await tx.select().from(schema.duplicateCandidate);
      expect(row).toMatchObject({ status: 'dismissed', decidedBy: reviewerId });
      const audit = await tx.select({ action: schema.auditLog.action }).from(schema.auditLog);
      expect(audit.map((a) => a.action)).toEqual(['duplicate_dismissed']);
      expect((await verifyAuditChain(tx, tenantId)).ok).toBe(true);
    });
  });
});
