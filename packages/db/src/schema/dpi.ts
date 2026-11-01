import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, syncColumns } from '../columns';

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
