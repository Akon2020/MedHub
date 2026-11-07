import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { appendOnlyColumns, syncColumns, tenantColumns } from '../columns';

/**
 * Invoice of a visit (docs/modules/fact.md section 2): open, then finalized
 * and never changed again (guard medhub_invoice_guard); a correction is a
 * credit note. Totals are the sum of the lines, computed when read.
 */
export const invoice = pgTable(
  'invoice',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    number: text('number').notNull(),
    officialNumber: text('official_number'),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    /** A late act on a finalized invoice opens a supplementary one (never rejected). */
    supplementaryOf: uuid('supplementary_of'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('invoice_number_uq').on(t.tenantId, t.number),
    index('invoice_patient_idx').on(t.tenantId, t.patientId, t.openedAt),
    index('invoice_encounter_idx').on(t.tenantId, t.encounterId),
    check('invoice_status_check', sql`${t.status} in ('open','finalized','voided')`),
  ],
);

/** One act billed: never changed, a priced line may replace a line without price. */
export const invoiceLine = pgTable(
  'invoice_line',
  {
    ...appendOnlyColumns(),
    invoiceId: uuid('invoice_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    serviceItemId: uuid('service_item_id'),
    code: text('code'),
    label: text('label').notNull(),
    category: text('category').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }),
    currency: text('currency').notNull(),
    priceListId: uuid('price_list_id'),
    manualPrice: boolean('manual_price').notNull().default(false),
    sourceTable: text('source_table'),
    sourceId: uuid('source_id'),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    /** Share of the third party (contract), the patient pays the rest. */
    payerShare: bigint('payer_share', { mode: 'number' }).notNull().default(0),
    contractId: uuid('contract_id'),
    beneficiaryId: uuid('beneficiary_id'),
    /** Trace of the coverage engine (decision, rule, version, reasons). */
    coverage: jsonb('coverage').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('invoice_line_invoice_idx').on(t.tenantId, t.invoiceId),
    index('invoice_line_source_idx').on(t.tenantId, t.sourceTable, t.sourceId),
    check('invoice_line_status_check', sql`${t.status} in ('active','superseded')`),
    check('invoice_line_quantity_check', sql`${t.quantity} > 0`),
    check('invoice_line_price_check', sql`${t.unitPrice} is null or ${t.unitPrice} >= 0`),
    check('invoice_line_payer_share_check', sql`${t.payerShare} >= 0`),
  ],
);

/** What a visit opening bills automatically (configuration, rule 8). */
export const billingRule = pgTable(
  'billing_rule',
  {
    ...tenantColumns(),
    encounterKind: text('encounter_kind'),
    departmentId: uuid('department_id'),
    serviceItemId: uuid('service_item_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('billing_rule_target_uq')
      .on(t.tenantId, t.encounterKind, t.departmentId)
      .where(sql`${t.isActive}`),
  ],
);
