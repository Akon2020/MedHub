import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../columns';

/** Nomenclature of billable services (docs/modules/fact.md section 1). */
export const serviceItem = pgTable(
  'service_item',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    departmentId: uuid('department_id'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('service_item_code_uq').on(t.tenantId, t.code),
    check(
      'service_item_category_check',
      sql`${t.category} in ('consultation','procedure','lab','imaging','bed_day','drug','consumable','other')`,
    ),
  ],
);

export const priceList = pgTable(
  'price_list',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    currency: text('currency').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('price_list_code_uq').on(t.tenantId, t.code),
    check(
      'price_list_kind_check',
      sql`${t.kind} in ('public','private','contract','foreigner','staff','indigent')`,
    ),
  ],
);

/** A dated price in minor units; a change is a new row, the history stays. */
export const price = pgTable(
  'price',
  {
    ...tenantColumns(),
    priceListId: uuid('price_list_id').notNull(),
    serviceItemId: uuid('service_item_id').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
  },
  (t) => [
    uniqueIndex('price_period_uq').on(t.tenantId, t.priceListId, t.serviceItemId, t.validFrom),
    index('price_service_idx').on(t.tenantId, t.serviceItemId),
    check('price_amount_check', sql`${t.amount} >= 0`),
    check('price_period_check', sql`${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`),
  ],
);

/** Taxes, inactive unless the structure sets them (fiscal rules: TODO(medhub-decision)). */
export const tax = pgTable(
  'tax',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    rate: numeric('rate', { precision: 9, scale: 6 }).notNull(),
    appliesTo: text('applies_to').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(false),
  },
  (t) => [uniqueIndex('tax_code_uq').on(t.tenantId, t.code)],
);

/** Exchange rates "1 from = rate to", never changed: a new rate is a new row. */
export const exchangeRate = pgTable(
  'exchange_rate',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    fromCurrency: text('from_currency').notNull(),
    toCurrency: text('to_currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
    validFrom: date('valid_from').notNull(),
    source: text('source').notNull().default('manual'),
  },
  (t) => [
    index('exchange_rate_pair_idx').on(t.tenantId, t.fromCurrency, t.toCurrency, t.validFrom),
    check('exchange_rate_positive_check', sql`${t.rate} > 0`),
  ],
);

/** Currencies a structure accepts at the cash desk and their cash rounding step (minor units). */
export const tenantCurrency = pgTable(
  'tenant_currency',
  {
    tenantId: uuid('tenant_id').notNull(),
    currency: text('currency').notNull(),
    cashRoundingStep: bigint('cash_rounding_step', { mode: 'number' }).notNull().default(0),
    isAccepted: boolean('is_accepted').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.currency] }),
    check('tenant_currency_rounding_check', sql`${t.cashRoundingStep} >= 0`),
  ],
);
