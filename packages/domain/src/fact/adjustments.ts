import { minorAmountSchema } from '@medhub/shared';
import { z } from 'zod';

/**
 * Discounts and credit notes (docs/modules/fact.md section 2). Both are asked
 * for at the cash desk, offline included, and take effect only once a second
 * authorised user approves them (owner decision S10: cap 0 for the cashier,
 * caps adjustable per role). An invoice is never changed: a discount or a
 * credit note is a separate row, the amount due is computed.
 */
export const ADJUSTMENT_KINDS = ['discount', 'credit_note'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

const base = {
  invoiceId: z.uuid(),
  patientId: z.uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: minorAmountSchema.refine((n) => n > 0, 'FACT_AMOUNT_ZERO'),
  reason: z.string().trim().min(5).max(300),
  requestedAt: z.iso.datetime(),
  status: z.literal('pending').default('pending'),
};

export const discountRequestPayload = z.object({
  ...base,
  kind: z.literal('discount').default('discount'),
});
export const creditNoteRequestPayload = z.object({
  ...base,
  kind: z.literal('credit_note').default('credit_note'),
});
export type AdjustmentRequestPayload = z.infer<typeof discountRequestPayload>;

export const approvalDecisionInput = z.object({
  id: z.uuid(),
  approve: z.boolean(),
  reason: z.string().trim().max(300).nullish(),
});

export const CREDIT_NOTE_NUMBER_TEMPLATE = 'AV-{YYYY}-{SEQ:6}';

/** Amount still billed once discounts and credit notes are taken off. */
export function amountBilled(gross: number, discounts: number, credits: number): number {
  return gross - discounts - credits;
}

/** A new discount or credit note cannot take off more than what is still billed. */
export function adjustmentAllowed(
  amount: number,
  gross: number,
  discounts: number,
  credits: number,
): boolean {
  return amount > 0 && amount <= amountBilled(gross, discounts, credits);
}

/** The approval cap of a user for a kind and currency: the highest of their roles, 0 by default. */
export function approvalCap(
  thresholds: readonly { roleId: string; kind: string; currency: string; maxAmount: number }[],
  roleIds: readonly string[],
  kind: AdjustmentKind,
  currency: string,
): number {
  return thresholds
    .filter((t) => roleIds.includes(t.roleId) && t.kind === kind && t.currency === currency)
    .reduce((max, t) => Math.max(max, t.maxAmount), 0);
}
