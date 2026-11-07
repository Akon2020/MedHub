import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { appendOnlyColumns, syncColumns, tenantColumns } from '../columns';

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

/** A signed referral voucher (bon d'envoi) presented by the beneficiary. */
export const referralVoucher = pgTable(
  'referral_voucher',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    beneficiaryId: uuid('beneficiary_id').notNull(),
    number: text('number').notNull(),
    signatory: text('signatory').notNull(),
    issuedOn: date('issued_on').notNull(),
    validUntil: date('valid_until').notNull(),
    encounterId: uuid('encounter_id'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('referral_voucher_number_uq').on(t.tenantId, t.contractId, t.number),
    index('referral_voucher_patient_idx').on(t.tenantId, t.patientId),
  ],
);

/**
 * Emergency covered without voucher (service card shown): to regularise with
 * a voucher within the delay of the plan; overdue ones are flagged.
 */
export const coverageException = pgTable(
  'coverage_exception',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    encounterId: uuid('encounter_id'),
    reason: text('reason').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    dueBy: timestamp('due_by', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('open'),
    voucherId: uuid('voucher_id'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('coverage_exception_patient_idx').on(t.tenantId, t.patientId),
    index('coverage_exception_due_idx').on(t.tenantId, t.status, t.dueBy),
    check('coverage_exception_status_check', sql`${t.status} in ('open','regularized')`),
  ],
);

/**
 * Prior authorization of an act (docs/modules/conv.md): asked at the cash
 * desk, offline included, and the payer's decision recorded online. A decided
 * request never changes (guard).
 */
export const priorAuthorization = pgTable(
  'prior_authorization',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    beneficiaryId: uuid('beneficiary_id').notNull(),
    serviceItemId: uuid('service_item_id'),
    serviceCode: text('service_code'),
    label: text('label').notNull(),
    currency: text('currency').notNull(),
    amountRequested: bigint('amount_requested', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    authorizedAmount: bigint('authorized_amount', { mode: 'number' }),
    validUntil: date('valid_until'),
    payerReference: text('payer_reference'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('prior_authorization_patient_idx').on(t.tenantId, t.patientId),
    index('prior_authorization_status_idx').on(t.tenantId, t.status, t.requestedAt),
    check(
      'prior_authorization_status_check',
      sql`${t.status} in ('pending','approved','rejected')`,
    ),
    check('prior_authorization_amount_check', sql`${t.amountRequested} > 0`),
  ],
);

/** Guarantee per worker held for a contract: received, then refunded at termination. */
export const guarantee = pgTable(
  'guarantee',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    contractId: uuid('contract_id').notNull(),
    memberNumber: text('member_number'),
    kind: text('kind').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('guarantee_contract_idx').on(t.tenantId, t.contractId),
    check('guarantee_kind_check', sql`${t.kind} in ('receive','refund')`),
    check('guarantee_amount_check', sql`${t.amount} > 0`),
  ],
);
