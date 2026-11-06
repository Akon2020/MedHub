import { minorAmountSchema } from '@medhub/shared';
import { z } from 'zod';
import {
  SERVICE_CATEGORIES,
  resolvePrice,
  type Price,
  type PriceList,
  type ServiceItem,
} from './pricing';

/**
 * Invoice basket (docs/modules/fact.md section 2). An invoice is opened for a
 * visit, receives one line per act (no double entry), is finalized then never
 * changed: a correction is a credit note. Totals are always the sum of the
 * lines; the paid state is derived from the allocated payments.
 */
export const INVOICE_STATUSES = ['open', 'finalized', 'voided'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Offline numbering: the device code keeps two workstations apart. */
export const INVOICE_NUMBER_TEMPLATE = 'FAC-{SITE}-{DEVICE}-{YYYY}-{SEQ:5}';

export const invoiceOpenPayload = z.object({
  patientId: z.uuid(),
  encounterId: z.uuid().nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  number: z.string().trim().min(3).max(40),
  openedAt: z.iso.datetime(),
  status: z.literal('open').default('open'),
});
export type InvoiceOpenPayload = z.infer<typeof invoiceOpenPayload>;

export const invoiceLinePayload = z
  .object({
    invoiceId: z.uuid(),
    patientId: z.uuid(),
    serviceItemId: z.uuid().nullish(),
    code: z.string().trim().max(30).nullish(),
    label: z.string().trim().min(2).max(200),
    category: z.enum(SERVICE_CATEGORIES),
    quantity: z.number().int().min(1).max(10_000),
    /** Null when no price was found (FACT_NO_PRICE): the act is kept and flagged. */
    unitPrice: minorAmountSchema.min(0).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    priceListId: z.uuid().nullish(),
    sourceTable: z.string().max(40).nullish(),
    sourceId: z.uuid().nullish(),
    performedAt: z.iso.datetime(),
    /** A priced line replacing a line without price, while the invoice is open. */
    supersedesId: z.uuid().nullish(),
    /** Price typed at the cash desk instead of the price lists (needs price:manage). */
    manualPrice: z.boolean().default(false),
  })
  .refine((l) => l.unitPrice === null || Number.isSafeInteger(l.unitPrice * l.quantity), {
    message: 'AMOUNT_OUT_OF_RANGE',
  });
export type InvoiceLinePayload = z.infer<typeof invoiceLinePayload>;

export const invoiceFinalizePayload = z.object({
  status: z.literal('finalized').default('finalized'),
  finalizedAt: z.iso.datetime(),
});

export type LineView = {
  id: string;
  invoiceId: string;
  label: string;
  quantity: number;
  unitPrice: number | null;
  currency: string;
  status?: string;
};

export function lineAmount(line: Pick<LineView, 'quantity' | 'unitPrice'>): number {
  return line.unitPrice === null ? 0 : line.quantity * line.unitPrice;
}

/** Total of an invoice in its currency, and the lines still waiting for a price. */
export function invoiceTotals(
  lines: readonly Pick<LineView, 'quantity' | 'unitPrice' | 'status'>[],
): {
  gross: number;
  missingPrices: number;
} {
  let gross = 0;
  let missingPrices = 0;
  for (const l of lines) {
    // A replaced line no longer counts: its replacement does.
    if (l.status === 'superseded') continue;
    if (l.unitPrice === null) missingPrices += 1;
    gross += lineAmount(l);
  }
  if (!Number.isSafeInteger(gross)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return { gross, missingPrices };
}

/** A line cannot be finalized without a price: the cash desk sets it first. */
export function canFinalize(
  lines: readonly Pick<LineView, 'quantity' | 'unitPrice' | 'status'>[],
): boolean {
  return lines.some((l) => l.status !== 'superseded') && invoiceTotals(lines).missingPrices === 0;
}

/** Automatic billing of a visit opening (owner decision S10: billed when the visit opens). */
export type BillingRule = {
  id: string;
  encounterKind: string | null;
  departmentId: string | null;
  serviceItemId: string;
  isActive: boolean;
};

/** Most specific active rule: kind and department, then department, then kind, then any. */
export function billingRuleFor(
  rules: readonly BillingRule[],
  visit: { kind: string; departmentId: string | null },
): BillingRule | null {
  const score = (r: BillingRule) => {
    if (r.encounterKind && r.encounterKind !== visit.kind) return -1;
    if (r.departmentId && r.departmentId !== visit.departmentId) return -1;
    return (r.departmentId ? 2 : 0) + (r.encounterKind ? 1 : 0);
  };
  return (
    rules
      .filter((r) => r.isActive)
      .map((r) => ({ r, s: score(r) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)[0]?.r ?? null
  );
}

export type LineDraft = Omit<
  InvoiceLinePayload,
  'invoiceId' | 'patientId' | 'performedAt' | 'supersedesId' | 'manualPrice'
>;

/** The line a service gives on a day, priced from the lists (null price when none applies). */
export function lineFor(
  service: ServiceItem,
  day: string,
  catalog: { priceLists: readonly PriceList[]; prices: readonly Price[] },
  fallbackCurrency: string,
  quantity = 1,
): LineDraft {
  const price = resolvePrice(
    { serviceItemId: service.id, day },
    catalog.priceLists,
    catalog.prices,
  );
  return {
    serviceItemId: service.id,
    code: service.code,
    label: service.name,
    category: service.category,
    quantity,
    unitPrice: price?.unitPrice.amount ?? null,
    currency: price?.unitPrice.currency ?? fallbackCurrency,
    priceListId: price?.priceListId ?? null,
  };
}
