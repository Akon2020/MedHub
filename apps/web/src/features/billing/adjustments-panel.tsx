'use client';

import { amountBilled, parseAmount, type AdjustmentKind } from '@medhub/domain';
import { AppError, DEFAULT_CURRENCIES } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { BadgePercent, Loader2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import type { InvoiceView } from './billing-helpers';
import { useMoney } from './invoice-card';

export type AdjustmentRow = {
  id: string;
  kind: 'discount' | 'credit_note' | 'request';
  requestKind: AdjustmentKind | null;
  invoiceId: string;
  amount: number;
  reason: string;
  status: string;
  number: string | null;
  pending: boolean;
};

export function adjustmentsOf(entities: {
  grants: LocalEntity[];
  credits: LocalEntity[];
  requests: LocalEntity[];
}): AdjustmentRow[] {
  const row = (e: LocalEntity, kind: AdjustmentRow['kind']): AdjustmentRow => ({
    id: e.id,
    kind,
    requestKind:
      kind === 'request' ? (e.data.kind === 'credit_note' ? 'credit_note' : 'discount') : null,
    invoiceId: String(e.data.invoiceId ?? ''),
    amount: Number(e.data.amount ?? 0),
    reason: String(e.data.reason ?? ''),
    status: String(e.data.status ?? 'active'),
    number: typeof e.data.number === 'string' ? e.data.number : null,
    pending: e.version === 0,
  });
  return [
    ...entities.grants.filter((e) => !e.rejected).map((e) => row(e, 'discount')),
    ...entities.credits.filter((e) => !e.rejected).map((e) => row(e, 'credit_note')),
    ...entities.requests.filter((e) => !e.rejected).map((e) => row(e, 'request')),
  ];
}

/** What discounts and credit notes take off an invoice. */
export function deductionsOf(rows: readonly AdjustmentRow[]): number {
  return rows
    .filter((r) => r.kind === 'discount' || r.kind === 'credit_note')
    .reduce((s, r) => s + r.amount, 0);
}

/**
 * Discounts and credit notes of an invoice (docs/modules/fact.md 2): asked at
 * the cash desk, offline included, granted only once another authorised user
 * approves them (owner decision S10). The invoice itself never changes.
 */
export function AdjustmentsPanel({
  invoice,
  gross,
  rows,
}: {
  invoice: InvoiceView;
  gross: number;
  rows: AdjustmentRow[];
}) {
  const t = useTranslations('billing.adjustments');
  const tErr = useTranslations('errors');
  const money = useMoney();
  const { dispatch, identity } = useRuntime();
  const perms = identity?.permissions ?? [];
  const [kind, setKind] = useState<AdjustmentKind>('discount');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discounts = rows.filter((r) => r.kind === 'discount').reduce((s, r) => s + r.amount, 0);
  const credits = rows.filter((r) => r.kind === 'credit_note').reduce((s, r) => s + r.amount, 0);
  const billed = amountBilled(gross, discounts, credits);
  const digits = DEFAULT_CURRENCIES[invoice.currency]?.minorUnit ?? 2;
  const value = parseAmount(amount, digits);
  const allowed =
    kind === 'discount' ? perms.includes('invoice:discount') : perms.includes('invoice:void');
  const canAsk =
    invoice.status !== 'voided' &&
    (perms.includes('invoice:discount') || perms.includes('invoice:void'));
  const pendingRequests = rows.filter((r) => r.kind === 'request' && r.status === 'pending');
  const decided = rows.filter((r) => r.kind === 'request' && r.status === 'rejected');

  async function ask() {
    if (value === null) return;
    setBusy(true);
    setError(null);
    try {
      await dispatch(kind === 'discount' ? 'discount.request' : 'credit_note.request', {
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        currency: invoice.currency,
        amount: value,
        reason: reason.trim(),
        requestedAt: new Date().toISOString(),
      });
      setAmount('');
      setReason('');
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0 && !canAsk) return null;
  return (
    <div className="grid gap-2 text-sm">
      {rows
        .filter((r) => r.kind !== 'request')
        .map((r) => (
          <p key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-success">
            <span>
              {r.kind === 'discount' ? t('discount') : t('creditNote', { number: r.number ?? '' })}{' '}
              · {r.reason}
            </span>
            <span className="font-mono">-{money(r.amount, invoice.currency)}</span>
          </p>
        ))}
      {(discounts > 0 || credits > 0) && (
        <p className="flex items-center justify-between font-semibold">
          <span>{t('billed')}</span>
          <span className="font-mono">{money(billed, invoice.currency)}</span>
        </p>
      )}
      {pendingRequests.map((r) => (
        <p key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-warning">
          <Badge variant="warning">{t('pendingApproval')}</Badge>
          {t(r.requestKind === 'credit_note' ? 'askedCredit' : 'askedDiscount', {
            amount: money(r.amount, invoice.currency),
          })}{' '}
          · {r.reason}
        </p>
      ))}
      {decided.map((r) => (
        <p key={r.id} className="text-xs text-muted-foreground">
          {t('rejected', { amount: money(r.amount, invoice.currency) })}
        </p>
      ))}
      {canAsk && billed > 0 && (
        <details className="rounded-xl bg-muted/50 p-3">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <BadgePercent className="size-4" aria-hidden />
            {t('ask')}
          </summary>
          <div className="mt-2 grid gap-2">
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                aria-label={t('kind')}
                className="w-48"
                value={kind}
                onChange={(e) => setKind(e.target.value as AdjustmentKind)}
              >
                <option value="discount">{t('kinds.discount')}</option>
                <option value="credit_note">{t('kinds.credit_note')}</option>
              </NativeSelect>
              <Input
                aria-label={t('amount', { currency: invoice.currency })}
                placeholder={t('amount', { currency: invoice.currency })}
                className="w-36"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAmount(String(billed / 10 ** digits))}
              >
                <Undo2 />
                {t('all')}
              </Button>
            </div>
            <Input
              aria-label={t('reason')}
              placeholder={t('reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <Button
              size="sm"
              className="justify-self-start"
              disabled={
                busy ||
                !allowed ||
                value === null ||
                value <= 0 ||
                value > billed ||
                reason.trim().length < 5
              }
              onClick={() => void ask()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <BadgePercent />}
              {t('send')}
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}
