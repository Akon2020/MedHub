import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, syncColumns } from '../columns';

/**
 * Cash session of a cashier on a workstation (docs/modules/fact.md section 4):
 * opened with a float per currency, closed once with the counted cash; never
 * reopened (guard medhub_cash_session_guard). The server recomputes the
 * expected cash from the payments it received.
 */
export const cashSession = pgTable(
  'cash_session',
  {
    ...syncColumns(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    openingFloat: jsonb('opening_float').$type<Record<string, number>>().notNull(),
    status: text('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    counted: jsonb('counted').$type<Record<string, number>>(),
    expected: jsonb('expected').$type<Record<string, number>>(),
    serverExpected: jsonb('server_expected').$type<Record<string, number>>(),
    justification: text('justification'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('cash_session_device_idx').on(t.tenantId, t.deviceId, t.openedAt),
    check('cash_session_status_check', sql`${t.status} in ('open','closed')`),
  ],
);

/** A payment received, never changed; a refund is a payment of the opposite sign. */
export const payment = pgTable(
  'payment',
  {
    ...appendOnlyColumns(),
    patientId: uuid('patient_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    cashSessionId: uuid('cash_session_id').notNull(),
    method: text('method').notNull(),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    invoiceCurrency: text('invoice_currency').notNull(),
    amountInInvoiceCurrency: bigint('amount_in_invoice_currency', { mode: 'number' }).notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }),
    exchangeRateDate: date('exchange_rate_date'),
    exchangeRateInverse: boolean('exchange_rate_inverse').notNull().default(false),
    roundingAdjustment: bigint('rounding_adjustment', { mode: 'number' }).notNull().default(0),
    change: bigint('change', { mode: 'number' }).notNull().default(0),
    reference: text('reference'),
    operator: text('operator'),
    receiptNumber: text('receipt_number').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('payment_invoice_idx').on(t.tenantId, t.invoiceId),
    index('payment_session_idx').on(t.tenantId, t.cashSessionId),
    uniqueIndex('payment_receipt_uq').on(t.tenantId, t.receiptNumber),
    uniqueIndex('payment_mobile_reference_uq')
      .on(t.tenantId, t.operator, t.reference)
      .where(sql`${t.method} = 'mobile_money'`),
    check(
      'payment_method_check',
      sql`${t.method} in ('cash','mobile_money','card','cheque','transfer')`,
    ),
  ],
);
