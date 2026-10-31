import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { patientSearchFields } from '@medhub/domain';
import { uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectDuplicates } from '../src/duplicates';

config({
  path: [resolve(__dirname, '../../../.env.local'), resolve(__dirname, '../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
let handle: DbHandle;

type Person = {
  familyName: string;
  givenName: string;
  sex: string;
  birthDate: string;
  birthDateEstimated?: boolean;
  phone: string | null;
};

async function addPatient(person: Person): Promise<string> {
  const id = uuidv7();
  await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
    tx.insert(schema.patient).values({
      id,
      tenantId,
      mrn: `TST-${id.slice(-8)}`,
      familyName: person.familyName,
      givenName: person.givenName,
      sex: person.sex,
      birthDate: person.birthDate,
      birthDateEstimated: person.birthDateEstimated ?? false,
      phone: person.phone,
      ...patientSearchFields({ ...person }),
    }),
  );
  return id;
}

describe.skipIf(!url)('duplicate detection (scenario P3)', () => {
  beforeAll(async () => {
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-DUP-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test doublons',
        displayName: 'Structure de test doublons',
        type: 'clinic',
        status: 'active',
      }),
    );
  });
  afterAll(async () => {
    await handle?.pool.end();
  });

  it('records one candidate pair for the P3 records, once', { timeout: 30_000 }, async () => {
    const first = await addPatient({
      familyName: 'Kabila',
      givenName: 'Jean',
      sex: 'M',
      birthDate: '1990-03-12',
      phone: '0991234567',
    });
    const second = await addPatient({
      familyName: 'Kabila',
      givenName: 'Jean',
      sex: 'M',
      birthDate: '1990-01-01',
      birthDateEstimated: true,
      phone: '+243 991 234 567',
    });
    await addPatient({
      familyName: 'Kabila',
      givenName: 'Jeanne',
      sex: 'F',
      birthDate: '2001-07-02',
      phone: null,
    });

    expect(await detectDuplicates(handle.db, tenantId, second)).toBe(1);
    expect(await detectDuplicates(handle.db, tenantId, first)).toBe(0);
    const pairs = await withTenant(handle.db, { tenantId, userId: null }, (tx) =>
      tx.select().from(schema.duplicateCandidate),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      patientAId: first < second ? first : second,
      patientBId: first < second ? second : first,
      score: 95,
      status: 'open',
    });
    expect(pairs[0]?.reasons).toEqual(['phonetic', 'name_similar', 'birth_year', 'phone']);
  });
});
