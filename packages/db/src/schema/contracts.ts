import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { syncColumns, tenantColumns } from '../columns';

/** A third party that pays for patients (docs/modules/conv.md section 2). */
export const payer = pgTable(
  'payer',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    contact: jsonb('contact').$type<Record<string, unknown>>().notNull().default({}),
    paymentTermDays: integer('payment_term_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('payer_code_uq').on(t.tenantId, t.code),
    check(
      'payer_kind_check',
      sql`${t.kind} in ('company','insurer','mutual','ngo','public_program')`,
    ),
  ],
);

export const contract = pgTable(
  'contract',
  {
    ...tenantColumns(),
    payerId: uuid('payer_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    currency: text('currency').notNull(),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    /** Day of the month the consolidated payer invoice is generated (25 by default). */
    invoiceDay: integer('invoice_day').notNull().default(25),
    /** Negotiated prices of covered acts; the public list otherwise. */
    priceListId: uuid('price_list_id'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contract_code_uq').on(t.tenantId, t.code),
    check('contract_status_check', sql`${t.status} in ('draft','active','suspended','terminated')`),
    check('contract_invoice_day_check', sql`${t.invoiceDay} between 1 and 31`),
  ],
);

/**
 * A plan of a contract, versioned like the configuration: a published
 * version is frozen (guard medhub_config_guard); a change is a new version,
 * and lines already billed keep the version they were evaluated with.
 */
export const contractPlan = pgTable(
  'contract_plan',
  {
    ...tenantColumns(),
    contractId: uuid('contract_id').notNull(),
    code: text('code').notNull(),
    version: integer('version').notNull(),
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by'),
  },
  (t) => [
    uniqueIndex('contract_plan_version_uq').on(t.tenantId, t.contractId, t.code, t.version),
    check('contract_plan_status_check', sql`${t.status} in ('draft','published','archived')`),
  ],
);

/** Members covered by a contract: workers and their dependants. */
export const beneficiary = pgTable(
  'beneficiary',
  {
    ...tenantColumns(),
    contractId: uuid('contract_id').notNull(),
    planCode: text('plan_code').notNull(),
    /** Number of the person at the payer (matricule); dependants have their own. */
    memberNumber: text('member_number').notNull(),
    /** Member number of the worker: the family. */
    familyNumber: text('family_number').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role').notNull(),
    birthDate: date('birth_date'),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    status: text('status').notNull().default('active'),
    isDayLaborer: boolean('is_day_laborer').notNull().default(false),
  },
  (t) => [
    uniqueIndex('beneficiary_member_uq').on(t.tenantId, t.contractId, t.memberNumber),
    index('beneficiary_family_idx').on(t.tenantId, t.contractId, t.familyNumber),
    check('beneficiary_role_check', sql`${t.role} in ('holder','spouse','child','dependent')`),
    check('beneficiary_status_check', sql`${t.status} in ('active','suspended','left')`),
  ],
);

/** Every change of the list, kept: entries, exits, changes, with their source. */
export const beneficiaryMovement = pgTable(
  'beneficiary_movement',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    beneficiaryId: uuid('beneficiary_id').notNull(),
    kind: text('kind').notNull(),
    effectiveOn: date('effective_on').notNull(),
    source: text('source').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('beneficiary_movement_idx').on(t.tenantId, t.beneficiaryId),
    check('beneficiary_movement_kind_check', sql`${t.kind} in ('entry','exit','change')`),
  ],
);

/** A patient linked to a beneficiary of a contract (synchronised, offline at the desk). */
export const patientCoverage = pgTable(
  'patient_coverage',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    beneficiaryId: uuid('beneficiary_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    unlinkReason: text('unlink_reason'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('patient_coverage_patient_idx').on(t.tenantId, t.patientId),
    check('patient_coverage_status_check', sql`${t.status} in ('active','ended')`),
  ],
);
