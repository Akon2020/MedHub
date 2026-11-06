import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, syncColumns, tenantColumns } from '../columns';

/**
 * Four-eyes requests (docs/05-roles-permissions.md, quatre yeux): asked at
 * the cash desk, offline included, decided online by another authorised
 * user. Once decided a request never changes (guard).
 */
export const approvalRequest = pgTable(
  'approval_request',
  {
    ...syncColumns(),
    kind: text('kind').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    fieldMeta: jsonb('field_meta')
      .$type<Record<string, { hlc: string; v: number }>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('approval_request_status_idx').on(t.tenantId, t.status, t.requestedAt),
    index('approval_request_invoice_idx').on(t.tenantId, t.invoiceId),
    check('approval_request_kind_check', sql`${t.kind} in ('discount','credit_note')`),
    check('approval_request_status_check', sql`${t.status} in ('pending','approved','rejected')`),
    check('approval_request_amount_check', sql`${t.amount} > 0`),
  ],
);

/** A discount granted on an invoice, never changed. */
export const discountGrant = pgTable(
  'discount_grant',
  {
    ...appendOnlyColumns(),
    approvalRequestId: uuid('approval_request_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('discount_grant_invoice_idx').on(t.tenantId, t.invoiceId),
    uniqueIndex('discount_grant_request_uq').on(t.tenantId, t.approvalRequestId),
    check('discount_grant_amount_check', sql`${t.amount} > 0`),
  ],
);

/** A credit note: the only way to cancel all or part of an invoice. */
export const creditNote = pgTable(
  'credit_note',
  {
    ...appendOnlyColumns(),
    approvalRequestId: uuid('approval_request_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    number: text('number').notNull(),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('credit_note_invoice_idx').on(t.tenantId, t.invoiceId),
    uniqueIndex('credit_note_number_uq').on(t.tenantId, t.number),
    uniqueIndex('credit_note_request_uq').on(t.tenantId, t.approvalRequestId),
    check('credit_note_amount_check', sql`${t.amount} > 0`),
  ],
);

/** Amount a role may grant without a second person (0 when absent: S10 decision). */
export const approvalThreshold = pgTable(
  'approval_threshold',
  {
    ...tenantColumns(),
    roleId: uuid('role_id').notNull(),
    kind: text('kind').notNull(),
    currency: text('currency').notNull(),
    maxAmount: bigint('max_amount', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('approval_threshold_uq').on(t.tenantId, t.roleId, t.kind, t.currency),
    check('approval_threshold_kind_check', sql`${t.kind} in ('discount','credit_note')`),
    check('approval_threshold_amount_check', sql`${t.maxAmount} >= 0`),
  ],
);
