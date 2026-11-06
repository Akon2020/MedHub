import { minorAmountSchema, money } from '@medhub/shared';
import { z } from 'zod';
import { convertWith, roundCash, type RateChoice } from './pricing';

/**
 * Payments and cash sessions (docs/modules/fact.md sections 3 and 4). A
 * payment is never changed: a refund is a payment of the opposite sign. The
 * paid state of an invoice and the expected cash of a session are always
 * computed from the payments and movements, never stored.
 */
export const PAYMENT_METHODS = ['cash', 'mobile_money', 'card', 'cheque', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const MOBILE_OPERATORS = ['mpesa', 'orange', 'airtel', 'africell', 'other'] as const;

export const RECEIPT_NUMBER_TEMPLATE = 'REC-{SITE}-{DEVICE}-{YYYY}-{SEQ:6}';

const currency = z.string().regex(/^[A-Z]{3}$/);
const rate = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);

export const paymentReceivePayload = z
  .object({
    patientId: z.uuid(),
    invoiceId: z.uuid(),
    cashSessionId: z.uuid(),
    method: z.enum(PAYMENT_METHODS),
    /** Amount received in the payment currency, rounding included, change excluded. */
    currency,
    amount: minorAmountSchema,
    /** What the payment settles on the invoice, in the invoice currency. */
    invoiceCurrency: currency,
    amountInInvoiceCurrency: minorAmountSchema,
    /** Rate used (null when both currencies are the same), and the day it was set. */
    exchangeRate: rate.nullable(),
    exchangeRateDate: z.iso.date().nullable(),
    exchangeRateInverse: z.boolean().default(false),
    /** Cash rounding added (positive) or given up (negative), in the payment currency. */
    roundingAdjustment: minorAmountSchema.default(0),
    /** Cash handed back, in the payment currency (shown on the receipt, not counted). */
    change: minorAmountSchema.min(0).default(0),
    reference: z.string().trim().max(60).nullish(),
    operator: z.enum(MOBILE_OPERATORS).nullish(),
    receiptNumber: z.string().trim().min(3).max(40),
    receivedAt: z.iso.datetime(),
    /** A refund is a payment of the opposite sign, with its reason. */
    refundReason: z.string().trim().min(5).max(300).nullish(),
  })
  .refine((p) => p.amount !== 0 && p.amountInInvoiceCurrency !== 0, { message: 'FACT_AMOUNT_ZERO' })
  .refine((p) => Math.sign(p.amount) === Math.sign(p.amountInInvoiceCurrency), {
    message: 'FACT_AMOUNT_SIGN',
  })
  .refine((p) => p.method !== 'mobile_money' || (Boolean(p.reference) && Boolean(p.operator)), {
    message: 'FACT_REFERENCE_REQUIRED',
    path: ['reference'],
  })
  .refine((p) => p.currency === p.invoiceCurrency || p.exchangeRate !== null, {
    message: 'FACT_RATE_REQUIRED',
  })
  .refine((p) => p.amount > 0 || Boolean(p.refundReason), {
    message: 'FACT_REFUND_REASON_REQUIRED',
    path: ['refundReason'],
  });
export type PaymentPayload = z.infer<typeof paymentReceivePayload>;

export const cashSessionOpenPayload = z.object({
  openedAt: z.iso.datetime(),
  /** Opening float per currency, in minor units. */
  openingFloat: z.record(currency, minorAmountSchema.min(0)),
  status: z.literal('open').default('open'),
});

export const cashSessionClosePayload = z
  .object({
    status: z.literal('closed').default('closed'),
    closedAt: z.iso.datetime(),
    /** Cash counted per currency, in minor units. */
    counted: z.record(currency, minorAmountSchema.min(0)),
    /** Expected cash per currency computed by the workstation (the server checks it). */
    expected: z.record(currency, minorAmountSchema),
    justification: z.string().trim().max(500).nullish(),
  })
  .refine(
    (c) =>
      Object.keys({ ...c.counted, ...c.expected }).every(
        (k) => (c.counted[k] ?? 0) === (c.expected[k] ?? 0),
      ) || (c.justification ?? '').trim().length >= 5,
    { message: 'FACT_CLOSE_JUSTIFICATION_REQUIRED', path: ['justification'] },
  );

export type PaymentView = {
  invoiceId: string;
  method: string;
  currency: string;
  amount: number;
  amountInInvoiceCurrency: number;
  cashSessionId: string;
};

/** Paid and remaining amounts of an invoice, in its currency. */
export function invoiceBalance(
  /** Amount billed: gross minus discounts and credit notes. */
  gross: number,
  payments: readonly Pick<PaymentView, 'amountInInvoiceCurrency'>[],
): {
  paid: number;
  remaining: number;
  state: 'unpaid' | 'partially_paid' | 'paid' | 'refund_due';
} {
  const paid = payments.reduce((s, p) => s + p.amountInInvoiceCurrency, 0);
  const remaining = gross - paid;
  return {
    paid,
    remaining,
    state:
      remaining < 0
        ? 'refund_due'
        : remaining === 0
          ? 'paid'
          : paid <= 0
            ? 'unpaid'
            : 'partially_paid',
  };
}

export type Quote = {
  /** Exact amount due in the payment currency. */
  exact: number;
  /** What the cashier asks for: rounded to the cash step for cash. */
  due: number;
  roundingAdjustment: number;
};

/**
 * What to ask for when the remaining balance is settled in a currency, with
 * the rate chosen for the day (or none for the invoice currency) and, in cash,
 * the rounding step of that currency (owner decision S10: 50 CDF by default).
 */
export function quote(
  remaining: number,
  invoiceCurrency: string,
  payCurrency: string,
  choice: RateChoice | null,
  method: PaymentMethod,
  roundingStep: number,
): Quote {
  let exact = remaining;
  if (payCurrency !== invoiceCurrency) {
    if (!choice) throw new Error('FACT_RATE_REQUIRED');
    exact = convertWith(money(remaining, invoiceCurrency), choice, payCurrency).amount;
  }
  const due = method === 'cash' ? roundCash(exact, roundingStep) : exact;
  return { exact, due, roundingAdjustment: due - exact };
}

/**
 * The part of the invoice a received amount settles. Paying the quoted
 * (rounded) amount settles the whole balance; a smaller amount is converted
 * back and never exceeds the balance; more is change.
 */
export function settlement(
  received: number,
  q: Quote,
  remaining: number,
  invoiceCurrency: string,
  payCurrency: string,
  choice: RateChoice | null,
): { amount: number; amountInInvoiceCurrency: number; roundingAdjustment: number; change: number } {
  if (received >= q.due) {
    return {
      amount: q.due,
      amountInInvoiceCurrency: remaining,
      roundingAdjustment: q.roundingAdjustment,
      change: received - q.due,
    };
  }
  let settled = received;
  if (payCurrency !== invoiceCurrency) {
    if (!choice) throw new Error('FACT_RATE_REQUIRED');
    const back: RateChoice = { ...choice, inverse: !choice.inverse };
    settled = convertWith(money(received, payCurrency), back, invoiceCurrency).amount;
  }
  return {
    amount: received,
    amountInInvoiceCurrency: Math.min(settled, remaining),
    roundingAdjustment: 0,
    change: 0,
  };
}

/** Cash expected in a session per currency: the float plus the cash received, minus refunds. */
export function expectedCash(
  openingFloat: Readonly<Record<string, number>>,
  payments: readonly Pick<PaymentView, 'method' | 'currency' | 'amount'>[],
): Record<string, number> {
  const out: Record<string, number> = { ...openingFloat };
  for (const p of payments) {
    if (p.method !== 'cash') continue;
    out[p.currency] = (out[p.currency] ?? 0) + p.amount;
  }
  return out;
}

/** Totals per method and currency of a session, for the closing report. */
export function sessionTotals(
  payments: readonly Pick<PaymentView, 'method' | 'currency' | 'amount'>[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const p of payments) {
    const byCurrency = (out[p.method] ??= {});
    byCurrency[p.currency] = (byCurrency[p.currency] ?? 0) + p.amount;
  }
  return out;
}
