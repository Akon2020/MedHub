import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, clinicalStatusCheck, syncColumns, tenantColumns } from '../columns';

export const patient = pgTable(
  'patient',
  {
    ...syncColumns(),
    personGlobalId: uuid('person_global_id'),
    mrn: text('mrn').notNull(),
    officialMrn: text('official_mrn'),
    familyName: text('family_name').notNull(),
    middleName: text('middle_name'),
    givenName: text('given_name'),
    sex: text('sex').notNull(),
    birthDate: date('birth_date', { mode: 'string' }),
    birthDateEstimated: boolean('birth_date_estimated').notNull().default(false),
    ageAtRegistration: integer('age_at_registration'),
    phone: text('phone'),
    sensitivity: text('sensitivity').notNull().default('normal'),
    searchText: text('search_text').notNull(),
    phoneticKey: text('phonetic_key').notNull(),
    extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
    /** Per-field HLC and version used by the field_merge conflict strategy. */
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
    mergedIntoId: uuid('merged_into_id'),
    deceasedAt: timestamp('deceased_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('patient_mrn_uq').on(t.tenantId, t.mrn),
    index('patient_phonetic_idx').on(t.tenantId, t.phoneticKey),
    index('patient_phone_idx').on(t.tenantId, t.phone),
    check('patient_sex_check', sql`${t.sex} in ('M','F','U')`),
    check(
      'patient_sensitivity_check',
      sql`${t.sensitivity} in ('normal','staff','vip','restricted')`,
    ),
  ],
);

export const vitalSign = pgTable(
  'vital_sign',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    code: text('code').notNull(),
    value: numeric('value', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    unit: text('unit').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    measuredBy: uuid('measured_by'),
    method: text('method'),
    isOutOfRange: boolean('is_out_of_range').notNull().default(false),
    plausibilityOverrideReason: text('plausibility_override_reason'),
  },
  (t) => [
    index('vital_sign_patient_idx').on(t.tenantId, t.patientId, t.measuredAt),
    check('vital_sign_status_check', clinicalStatusCheck),
  ],
);

/**
 * Pair of records that may describe the same person, found on the server after
 * a synchronised registration. Patient A has the smaller identifier, so a pair
 * is stored once. A decision closes the pair; nothing is deleted.
 */
export const duplicateCandidate = pgTable(
  'duplicate_candidate',
  {
    ...tenantColumns(),
    patientAId: uuid('patient_a_id').notNull(),
    patientBId: uuid('patient_b_id').notNull(),
    score: integer('score').notNull(),
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').notNull().default('open'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
  },
  (t) => [
    uniqueIndex('duplicate_candidate_pair_uq').on(t.tenantId, t.patientAId, t.patientBId),
    index('duplicate_candidate_status_idx').on(t.tenantId, t.status, t.score),
    check('duplicate_candidate_status_check', sql`${t.status} in ('open','dismissed','merged')`),
    check('duplicate_candidate_order_check', sql`${t.patientAId} < ${t.patientBId}`),
  ],
);
