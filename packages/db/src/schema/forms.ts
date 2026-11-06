import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, clinicalStatusCheck, tenantColumns } from '../columns';

/** A configurable clinical form of the structure (docs/modules/form.md). */
export const formDefinition = pgTable(
  'form_definition',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    step: text('step').notNull(),
    title: jsonb('title').$type<{ fr: string; en?: string }>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('form_definition_code_uq').on(t.tenantId, t.code)],
);

/**
 * Versions of a form: a draft is edited freely; once published it is frozen
 * (guard medhub_config_guard), a change creates the next version.
 */
export const formVersion = pgTable(
  'form_version',
  {
    ...tenantColumns(),
    formDefinitionId: uuid('form_definition_id').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by'),
  },
  (t) => [
    uniqueIndex('form_version_uq').on(t.tenantId, t.formDefinitionId, t.version),
    check('form_version_status_check', sql`${t.status} in ('draft','published','archived')`),
  ],
);

/** A response to a form version, append-only like every clinical fact. */
export const formResponse = pgTable(
  'form_response',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    formVersionId: uuid('form_version_id').notNull(),
    formCode: text('form_code').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    state: text('state').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    signedBy: uuid('signed_by'),
    correctionReason: text('correction_reason'),
  },
  (t) => [
    index('form_response_patient_idx').on(t.tenantId, t.patientId, t.completedAt),
    check('form_response_status_check', clinicalStatusCheck),
    check('form_response_state_check', sql`${t.state} in ('completed','signed')`),
  ],
);
