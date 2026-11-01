import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, syncColumns, tenantColumns } from '../columns';

const fieldMeta = () =>
  jsonb('field_meta').$type<Record<string, { hlc: string; v: number }>>().notNull().default({});

/** Union rows: never deleted, retracted with a reason (docs/modules/dpi.md section 2). */
const unionColumns = () => ({
  ...syncColumns(),
  patientId: uuid('patient_id').notNull(),
  notedAt: timestamp('noted_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('active'),
  retractReason: text('retract_reason'),
  retractedAt: timestamp('retracted_at', { withTimezone: true }),
  fieldMeta: fieldMeta(),
});

export const allergy = pgTable(
  'allergy',
  {
    ...unionColumns(),
    substance: text('substance'),
    atcCode: text('atc_code'),
    category: text('category'),
    reaction: text('reaction'),
    severity: text('severity'),
    certainty: text('certainty'),
    /** "No known allergy", dated, distinct from a record where nobody asked. */
    noneKnown: boolean('none_known').notNull().default(false),
  },
  (t) => [
    index('allergy_patient_idx').on(t.tenantId, t.patientId),
    check('allergy_status_check', sql`${t.status} in ('active','retracted')`),
    check(
      'allergy_content_check',
      sql`${t.noneKnown} or (${t.substance} is not null and ${t.severity} is not null)`,
    ),
  ],
);

export const medicalHistory = pgTable(
  'medical_history',
  {
    ...unionColumns(),
    category: text('category').notNull(),
    label: text('label').notNull(),
    icd10: text('icd10'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    source: text('source').notNull().default('patient'),
  },
  (t) => [
    index('medical_history_patient_idx').on(t.tenantId, t.patientId),
    check('medical_history_status_check', sql`${t.status} in ('active','retracted')`),
  ],
);

export const problem = pgTable(
  'problem',
  {
    ...unionColumns(),
    label: text('label').notNull(),
    icd10: text('icd10'),
    onsetDate: date('onset_date', { mode: 'string' }),
    resolvedDate: date('resolved_date', { mode: 'string' }),
    sourceEncounterId: uuid('source_encounter_id'),
  },
  (t) => [
    index('problem_patient_idx').on(t.tenantId, t.patientId),
    check('problem_status_check', sql`${t.status} in ('active','resolved','inactive','retracted')`),
  ],
);

/**
 * Single timeline of the record (docs/04 section 6): one row per clinical
 * fact, written by the server when the fact is stored; `origin_tenant_id` is
 * the hook for copies received from other structures (SHARE, phase 2).
 */
export const clinicalEvent = pgTable(
  'clinical_event',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    kind: text('kind').notNull(),
    refTable: text('ref_table').notNull(),
    refId: uuid('ref_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    authorId: uuid('author_id'),
    originTenantId: uuid('origin_tenant_id'),
  },
  (t) => [index('clinical_event_patient_idx').on(t.tenantId, t.patientId, t.occurredAt)],
);

/**
 * Vital sign settings of the structure: plausibility bounds (typing errors),
 * stability margin of the trend arrow and normal ranges by sex and age. Codes
 * without a row use the built-in plausibility bounds and have no normal range.
 */
export const vitalSignDefinition = pgTable(
  'vital_sign_definition',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    plausibleMin: doublePrecision('plausible_min').notNull(),
    plausibleMax: doublePrecision('plausible_max').notNull(),
    stabilityMargin: doublePrecision('stability_margin'),
    normalRanges: jsonb('normal_ranges').$type<Record<string, unknown>[]>().notNull().default([]),
    updatedBy: uuid('updated_by'),
  },
  (t) => [uniqueIndex('vital_sign_definition_code_uq').on(t.tenantId, t.code)],
);

/** Emergency accesses, reviewed afterwards (docs/03 section 4); never deleted. */
export const breakGlassEvent = pgTable(
  'break_glass_event',
  {
    ...appendOnlyColumns(),
    userId: uuid('user_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewOutcome: text('review_outcome'),
    reviewComment: text('review_comment'),
  },
  (t) => [
    index('break_glass_user_idx').on(t.tenantId, t.userId, t.patientId, t.endsAt),
    index('break_glass_review_idx').on(t.tenantId, t.reviewedAt),
    check(
      'break_glass_outcome_check',
      sql`${t.reviewOutcome} is null or ${t.reviewOutcome} in ('justified','to_investigate')`,
    ),
  ],
);
