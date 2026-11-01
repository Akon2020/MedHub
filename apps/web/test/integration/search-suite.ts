import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { patientSearchFields } from '@medhub/domain';
import { isAppError, uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

type Person = {
  familyName: string;
  middleName?: string;
  givenName?: string;
  sex: string;
  birthDate: string;
  phone?: string;
  motherName?: string;
  cardToken?: string;
};

const PEOPLE: (Person & { mrn: string })[] = [
  {
    mrn: 'KIN-AA-26-00001',
    familyName: 'Kabila',
    givenName: 'Jean',
    sex: 'M',
    birthDate: '1990-03-12',
    phone: '0991234567',
    cardToken: 'MHC1-ABCDEFGHJKMNPQRSTVWX',
  },
  {
    mrn: 'KIN-AA-26-00002',
    familyName: 'Kabila',
    givenName: 'Jeanne',
    sex: 'F',
    birthDate: '2001-07-02',
  },
  {
    mrn: 'KIN-AA-26-00003',
    familyName: 'Mbuyi',
    middleName: 'Ilunga',
    givenName: 'Grâce',
    sex: 'F',
    birthDate: '1985-05-01',
    motherName: 'Tshibanda Ruth',
  },
  {
    mrn: 'KIN-AA-26-00004',
    familyName: 'Lukusa',
    givenName: 'Patrick',
    sex: 'M',
    birthDate: '1990-11-30',
  },
];

/**
 * The same expectations with pg_trgm and with the fallback search
 * (MEDHUB_SEARCH_TRIGRAM=off), the latter being likely on shared hosting.
 */
export function defineSearchSuite(mode: 'auto' | 'off'): void {
  const url = process.env.TEST_DATABASE_URL;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const outsiderId = uuidv7();
  const ids = new Map<string, string>();
  let handle: DbHandle;
  type Search = typeof import('@/server/modules/pat/search');
  let search: Search;
  const ctx = (user = userId) => ({
    tenantId,
    userId: user,
    sessionId: uuidv7(),
    deviceId: null,
    mfaVerifiedAt: null,
  });
  const names = async (q: string) =>
    (await search.searchPatients(ctx(), { q, cursor: 0 })).hits.map((h) => h.mrn).sort();

  describe.skipIf(!url)(
    `server patient search (${mode === 'auto' ? 'pg_trgm' : 'fallback'})`,
    () => {
      beforeAll(async () => {
        process.env.DATABASE_URL = url;
        process.env.MEDHUB_SEARCH_TRIGRAM = mode;
        process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 12).toString('base64');
        process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
        search = await import('@/server/modules/pat/search');
        handle = createDb(url as string, 4);
        await withSystem(handle.db, (tx) =>
          tx.insert(schema.tenant).values({
            id: tenantId,
            code: `TST-SR${mode === 'auto' ? 'A' : 'F'}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
            legalName: 'Structure de test recherche',
            displayName: 'Structure de test recherche',
            type: 'clinic',
            status: 'active',
          }),
        );
        await withTenant(handle.db, { tenantId, userId: null }, async (tx) => {
          const roleId = uuidv7();
          const emptyRole = uuidv7();
          await tx.insert(schema.role).values([
            { id: roleId, tenantId, code: 'reception', name: 'Accueil' },
            { id: emptyRole, tenantId, code: 'none', name: 'Aucun' },
          ]);
          await tx
            .insert(schema.rolePermission)
            .values({ tenantId, roleId, permissionKey: 'patient:read' });
          await tx.insert(schema.userAccount).values([
            {
              id: userId,
              tenantId,
              username: 'accueil',
              displayName: 'Accueil',
              passwordHash: 'x',
            },
            {
              id: outsiderId,
              tenantId,
              username: 'autre',
              displayName: 'Autre',
              passwordHash: 'x',
            },
          ]);
          await tx.insert(schema.userRole).values([
            { id: uuidv7(), tenantId, userId, roleId },
            { id: uuidv7(), tenantId, userId: outsiderId, roleId: emptyRole },
          ]);
          for (const person of PEOPLE) {
            const id = uuidv7();
            ids.set(person.mrn, id);
            await tx.insert(schema.patient).values({
              id,
              tenantId,
              ...person,
              ...patientSearchFields(person),
            });
          }
          // A merged record never comes back from a search.
          await tx.insert(schema.patient).values({
            id: uuidv7(),
            tenantId,
            mrn: 'KIN-AA-26-00099',
            familyName: 'Kabila',
            givenName: 'Jean',
            sex: 'M',
            birthDate: '1990-03-12',
            mergedIntoId: ids.get('KIN-AA-26-00001') ?? null,
            ...patientSearchFields({ familyName: 'Kabila', givenName: 'Jean' }),
          });
        });
      });

      afterAll(async () => {
        await handle?.pool.end();
      });

      it('finds by name, tolerating spelling and accents, never a merged record', async () => {
        expect(await names('kabila')).toEqual(['KIN-AA-26-00001', 'KIN-AA-26-00002']);
        expect(await names('Cabila Jean')).toContain('KIN-AA-26-00001');
        expect(await names('grace mbuyi')).toEqual(['KIN-AA-26-00003']);
      });

      it('narrows with a birth year, and finds by phone, record number or mother', async () => {
        expect(await names('Kabila 1990')).toEqual(['KIN-AA-26-00001']);
        expect(await names('+243 991 234 567')).toEqual(['KIN-AA-26-00001']);
        expect(await names('kin-aa-26-00004')).toEqual(['KIN-AA-26-00004']);
        expect(await names('Tshibanda Ruth')).toEqual(['KIN-AA-26-00003']);
        expect(await names(' mhc1-abcdefghjkmnpqrstvwx ')).toEqual(['KIN-AA-26-00001']);
      });

      it('requires patient:read and returns the state a device stores', async () => {
        try {
          await search.searchPatients(ctx(outsiderId), { q: 'kabila', cursor: 0 });
          throw new Error('expected PERMISSION_DENIED');
        } catch (error) {
          expect(isAppError(error) ? error.code : error).toBe('PERMISSION_DENIED');
        }
        const id = ids.get('KIN-AA-26-00003') ?? '';
        const state = await search.fetchPatient(ctx(), id);
        expect(state).toMatchObject({
          id,
          version: 1,
          data: { familyName: 'Mbuyi', motherName: 'Tshibanda Ruth' },
        });
      });
    },
  );
}
