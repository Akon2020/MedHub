import {
  ALL_PERMISSION_KEYS,
  CURRENCIES,
  DRC_PROVINCES,
  PROVINCES_SOURCE,
  scopesFor,
  UNITS,
} from '@medhub/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/client';
import { adminArea, currency, permission, unit } from '../src/schema';

const MODULE_BY_RESOURCE: Record<string, string> = {
  patient: 'pat',
  encounter: 'rdv',
  appointment: 'rdv',
  queue: 'rdv',
  triage: 'rdv',
  clinical_record: 'dpi',
  vital_sign: 'dpi',
  diagnosis: 'dpi',
  prescription: 'dpi',
  medication_administration: 'dpi',
  lab_order: 'lab',
  lab_result: 'lab',
  dispensation: 'phar',
  stock: 'phar',
  controlled_substance: 'phar',
  invoice: 'fact',
  payment: 'fact',
  cash_session: 'fact',
  price: 'fact',
  contract: 'conv',
  beneficiary: 'conv',
  prior_authorization: 'conv',
  payer_invoice: 'conv',
  form: 'form',
  account: 'sadm',
};

/** Platform reference data that every environment needs (idempotent upsert). */
export async function seedReferenceData(db: Db): Promise<void> {
  const rows = ALL_PERMISSION_KEYS.map((key) => {
    const resource = key.split(':')[0] ?? '';
    return {
      key,
      moduleCode: MODULE_BY_RESOURCE[resource] ?? 'core',
      scopesAllowed: [...scopesFor(key)],
    };
  });
  await db
    .insert(permission)
    .values(rows)
    .onConflictDoUpdate({
      target: permission.key,
      set: {
        moduleCode: sql`excluded.module_code`,
        scopesAllowed: sql`excluded.scopes_allowed`,
      },
    });

  await db
    .insert(currency)
    .values([...CURRENCIES])
    .onConflictDoUpdate({
      target: currency.code,
      set: {
        nameFr: sql`excluded.name_fr`,
        nameEn: sql`excluded.name_en`,
        minorUnit: sql`excluded.minor_unit`,
        symbol: sql`excluded.symbol`,
      },
    });
  await db
    .insert(unit)
    .values([...UNITS])
    .onConflictDoUpdate({
      target: unit.code,
      set: {
        kind: sql`excluded.kind`,
        symbol: sql`excluded.symbol`,
        labelFr: sql`excluded.label_fr`,
        labelEn: sql`excluded.label_en`,
      },
    });
  // Lower levels (territories, cities, communes) come from an official file: pnpm db:import-areas.
  await db
    .insert(adminArea)
    .values(
      DRC_PROVINCES.map((p) => ({
        code: p.code,
        level: 1,
        kind: 'province',
        name: p.name,
        source: PROVINCES_SOURCE,
      })),
    )
    .onConflictDoUpdate({ target: adminArea.code, set: { name: sql`excluded.name` } });
}
