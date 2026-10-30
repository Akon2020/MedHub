import { ALL_PERMISSION_KEYS } from '@medhub/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/client';
import { permission } from '../src/schema';

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
    return { key, moduleCode: MODULE_BY_RESOURCE[resource] ?? 'core' };
  });
  await db
    .insert(permission)
    .values(rows)
    .onConflictDoUpdate({ target: permission.key, set: { moduleCode: sql`excluded.module_code` } });
}
