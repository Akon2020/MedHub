import { invoiceTotals } from '@medhub/domain';
import type { LocalEntity } from '@medhub/sync/client';

export type InvoiceView = {
  id: string;
  patientId: string;
  encounterId: string | null;
  number: string;
  currency: string;
  status: 'open' | 'finalized' | 'voided';
  openedAt: string;
  finalizedAt: string | null;
  supplementaryOf: string | null;
  pending: boolean;
};

export type InvoiceLineView = {
  id: string;
  invoiceId: string;
  serviceItemId: string | null;
  code: string | null;
  label: string;
  category: string;
  quantity: number;
  unitPrice: number | null;
  currency: string;
  manualPrice: boolean;
  status: string;
  performedAt: string;
  pending: boolean;
};

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function toInvoiceView(e: LocalEntity): InvoiceView {
  const d = e.data;
  const status = s(d.status);
  return {
    id: e.id,
    patientId: s(d.patientId) ?? '',
    encounterId: s(d.encounterId),
    number: s(d.number) ?? '',
    currency: s(d.currency) ?? 'USD',
    status: status === 'finalized' || status === 'voided' ? status : 'open',
    openedAt: s(d.openedAt) ?? '',
    finalizedAt: s(d.finalizedAt),
    supplementaryOf: s(d.supplementaryOf),
    pending: e.version === 0,
  };
}

export function toLineView(e: LocalEntity): InvoiceLineView {
  const d = e.data;
  return {
    id: e.id,
    invoiceId: s(d.invoiceId) ?? '',
    serviceItemId: s(d.serviceItemId),
    code: s(d.code),
    label: s(d.label) ?? '',
    category: s(d.category) ?? 'other',
    quantity: typeof d.quantity === 'number' ? d.quantity : 1,
    unitPrice: typeof d.unitPrice === 'number' ? d.unitPrice : null,
    currency: s(d.currency) ?? 'USD',
    manualPrice: d.manualPrice === true,
    status: s(d.status) ?? 'active',
    performedAt: s(d.performedAt) ?? '',
    pending: e.version === 0,
  };
}

export function totalsOf(lines: readonly InvoiceLineView[]) {
  return invoiceTotals(lines);
}
