import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, syncColumns, tenantColumns } from '../columns';

/** Drug catalogue of the structure, imported by CSV (nothing preloaded, S9 decision). */
export const drug = pgTable(
  'drug',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    inn: text('inn').notNull(),
    atcCode: text('atc_code'),
    form: text('form'),
    strength: text('strength'),
    route: text('route'),
    doseUnit: text('dose_unit'),
    maxSingleDose: doublePrecision('max_single_dose'),
    maxDailyDose: doublePrecision('max_daily_dose'),
    maxDailyDosePerKg: doublePrecision('max_daily_dose_per_kg'),
    pregnancyCategory: text('pregnancy_category'),
    minAgeMonths: integer('min_age_months'),
    geriatricCaution: boolean('geriatric_caution').notNull().default(false),
    renalCaution: boolean('renal_caution').notNull().default(false),
    hepaticCaution: boolean('hepatic_caution').notNull().default(false),
    isControlled: boolean('is_controlled').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    source: text('source').notNull().default('local'),
  },
  (t) => [uniqueIndex('drug_code_uq').on(t.tenantId, t.code)],
);

/** Interaction rules imported by the structure; a code may be an ATC class prefix. */
export const drugInteractionRule = pgTable(
  'drug_interaction_rule',
  {
    ...tenantColumns(),
    atcA: text('atc_a').notNull(),
    atcB: text('atc_b').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
  },
  (t) => [
    uniqueIndex('drug_interaction_pair_uq').on(t.tenantId, t.atcA, t.atcB),
    check(
      'drug_interaction_severity_check',
      sql`${t.severity} in ('minor','moderate','major','contraindicated')`,
    ),
  ],
);

/** A signed prescription; never changed, only cancelled (append-only). */
export const prescription = pgTable(
  'prescription',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    kind: text('kind').notNull().default('outpatient'),
    prescribedAt: timestamp('prescribed_at', { withTimezone: true }).notNull(),
    prescriberId: uuid('prescriber_id'),
    /** Printed under the QR code, checked online by the verification page. */
    verificationCode: text('verification_code').notNull(),
  },
  (t) => [
    index('prescription_patient_idx').on(t.tenantId, t.patientId, t.prescribedAt),
    uniqueIndex('prescription_verification_uq').on(t.verificationCode),
    check('prescription_status_check', sql`${t.status} in ('active','completed','cancelled')`),
  ],
);

export const prescriptionItem = pgTable(
  'prescription_item',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    opId: uuid('op_id'),
    hlc: text('hlc'),
    deviceId: uuid('device_id'),
    prescriptionId: uuid('prescription_id').notNull(),
    position: integer('position').notNull(),
    drugId: uuid('drug_id'),
    drugCode: text('drug_code'),
    label: text('label').notNull(),
    atcCode: text('atc_code'),
    doseValue: doublePrecision('dose_value').notNull(),
    doseUnit: text('dose_unit').notNull(),
    route: text('route'),
    frequency: text('frequency').notNull(),
    durationDays: integer('duration_days'),
    quantity: doublePrecision('quantity'),
    instructions: text('instructions'),
    substitutionAllowed: boolean('substitution_allowed').notNull().default(true),
    status: text('status').notNull().default('prescribed'),
    alertsAcknowledged: jsonb('alerts_acknowledged')
      .$type<{ code: string; severity: string; justification: string }[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    index('prescription_item_prescription_idx').on(t.tenantId, t.prescriptionId),
    check(
      'prescription_item_status_check',
      sql`${t.status} in ('prescribed','dispensed','partially_dispensed','administered','stopped')`,
    ),
  ],
);

/** Habitual treatments told by the patient or another facility (reconciliation). */
export const medicationStatement = pgTable(
  'medication_statement',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    notedAt: timestamp('noted_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    label: text('label').notNull(),
    atcCode: text('atc_code'),
    dose: text('dose'),
    source: text('source').notNull(),
    startedOn: date('started_on'),
    stoppedOn: date('stopped_on'),
    stopReason: text('stop_reason'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('medication_statement_patient_idx').on(t.tenantId, t.patientId),
    check(
      'medication_statement_status_check',
      sql`${t.status} in ('active','stopped','retracted')`,
    ),
  ],
);

export const medicationReconciliation = pgTable(
  'medication_reconciliation',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    kind: text('kind').notNull(),
    decisions: jsonb('decisions').$type<Record<string, unknown>[]>().notNull(),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('medication_reconciliation_patient_idx').on(t.tenantId, t.patientId)],
);
