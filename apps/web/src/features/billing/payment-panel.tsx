'use client';

import {
  formatNumber,
  invoiceBalance,
  MOBILE_OPERATORS,
  parseAmount,
  PAYMENT_METHODS,
  quote,
  rateFor,
  RECEIPT_NUMBER_TEMPLATE,
  settlement,
  type PaymentMethod,
} from '@medhub/domain';
import { AppError, DEFAULT_CURRENCIES } from '@medhub/shared';
import { AlertTriangle, Banknote, Loader2, Printer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { localDay } from '@/features/visits/visit-helpers';
import { totalsOf, type InvoiceLineView, type InvoiceView } from './billing-helpers';
import { useOpenSession, type PaymentRow } from './cash-session';
import { useMoney } from './invoice-card';
import { useReceiptPrint } from './receipt-pdf';

/**
 * Payment of an invoice (docs/modules/fact.md 3), offline included: any
 * accepted currency at the last known rate (with its date when it is not the
 * rate of the day), cash rounded to the step of the currency, change given,
 * a numbered receipt for every payment.
 */
export function PaymentPanel({
  invoice,
  lines,
  payments,
  deductions,
  patientName,
}: {
  invoice: InvoiceView;
  lines: InvoiceLineView[];
  payments: PaymentRow[];
  /** Discounts and credit notes granted on the invoice. */
  deductions: number;
  patientName: string;
}) {
  const t = useTranslations('billing.payment');
  const tm = useTranslations('billing.session.methods');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const money = useMoney();
  const print = useReceiptPrint();
  const { dispatch, nextCounter, catalogs, identity, device } = useRuntime();
  const session = useOpenSession();
  const finance = catalogs?.snapshot.finance;
  const accepted = (
    finance?.currencies ?? [{ currency: invoice.currency, cashRoundingStep: 0, isAccepted: true }]
  )
    .filter((c) => c.isAccepted)
    .map((c) => c.currency);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [currency, setCurrency] = useState(invoice.currency);
  const [received, setReceived] = useState('');
  const [operator, setOperator] = useState<(typeof MOBILE_OPERATORS)[number]>('mpesa');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The patient pays what the contracts leave: gross minus the payers' shares.
  const gross = totalsOf(lines).patient - deductions;
  const [refundReason, setRefundReason] = useState('');
  const canRefund = identity?.permissions.includes('payment:refund') ?? false;
  const balance = invoiceBalance(gross, payments);
  const canReceive = identity?.permissions.includes('payment:receive') ?? false;
  const today = localDay(new Date());
  const choice =
    currency === invoice.currency
      ? null
      : rateFor(finance?.exchangeRates ?? [], invoice.currency, currency, today);
  const step = finance?.currencies.find((c) => c.currency === currency)?.cashRoundingStep ?? 0;
  const digits = DEFAULT_CURRENCIES[currency]?.minorUnit ?? 2;
  const q =
    balance.remaining > 0 && (currency === invoice.currency || choice)
      ? quote(balance.remaining, invoice.currency, currency, choice, method, step)
      : null;
  const amount = parseAmount(received, digits);
  const outcome =
    q && amount !== null && amount > 0
      ? settlement(amount, q, balance.remaining, invoice.currency, currency, choice)
      : null;

  async function receive() {
    if (!session || !outcome || !q) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const seq = await nextCounter(`receipt:${now.getFullYear()}`);
      const receiptNumber = formatNumber(RECEIPT_NUMBER_TEMPLATE, {
        site: identity?.siteCode ?? 'SIT',
        device: device?.deviceCode ?? 'XX',
        year: now.getFullYear(),
        seq,
      });
      const payload = {
        patientId: invoice.patientId,
        invoiceId: invoice.id,
        cashSessionId: session.id,
        method,
        currency,
        amount: outcome.amount,
        invoiceCurrency: invoice.currency,
        amountInInvoiceCurrency: outcome.amountInInvoiceCurrency,
        exchangeRate: choice?.rate ?? null,
        exchangeRateDate: choice?.validFrom ?? null,
        exchangeRateInverse: choice?.inverse ?? false,
        roundingAdjustment: outcome.roundingAdjustment,
        change: outcome.change,
        reference:
          method === 'mobile_money' ||
          method === 'card' ||
          method === 'cheque' ||
          method === 'transfer'
            ? reference.trim() || null
            : null,
        operator: method === 'mobile_money' ? operator : null,
        receiptNumber,
        receivedAt: now.toISOString(),
      };
      const { entityId } = await dispatch('payment.receive', payload);
      setReceived('');
      setReference('');
      await print({
        payment: {
          ...payload,
          id: entityId,
          reference: payload.reference ?? null,
          operator: payload.operator ?? null,
          pending: true,
        },
        invoice,
        lines,
        patientName,
        remaining: balance.remaining - outcome.amountInInvoiceCurrency,
      }).catch(() => undefined);
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    if (!session || balance.remaining >= 0) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const seq = await nextCounter(`receipt:${now.getFullYear()}`);
      await dispatch('payment.refund', {
        patientId: invoice.patientId,
        invoiceId: invoice.id,
        cashSessionId: session.id,
        method: 'cash',
        currency: invoice.currency,
        amount: balance.remaining,
        invoiceCurrency: invoice.currency,
        amountInInvoiceCurrency: balance.remaining,
        exchangeRate: null,
        exchangeRateDate: null,
        refundReason: refundReason.trim(),
        receiptNumber: formatNumber(RECEIPT_NUMBER_TEMPLATE, {
          site: identity?.siteCode ?? 'SIT',
          device: device?.deviceCode ?? 'XX',
          year: now.getFullYear(),
          seq,
        }),
        receivedAt: now.toISOString(),
      });
      setRefundReason('');
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl p-3 ring-1 ring-border">
      {balance.remaining < 0 && canRefund && session && (
        <div className="grid gap-2 rounded-lg bg-warning-soft p-3 text-warning">
          <p>{t('refundDue', { amount: money(-balance.remaining, invoice.currency) })}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={t('refundReason')}
              placeholder={t('refundReason')}
              className="min-w-0 flex-1 bg-card"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || refundReason.trim().length < 5}
              onClick={() => void refund()}
            >
              {t('refund')}
            </Button>
          </div>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('balance')}</span>
        <span className="font-mono">{money(balance.remaining, invoice.currency)}</span>
        <Badge
          variant={
            balance.state === 'paid'
              ? 'info'
              : balance.state === 'partially_paid'
                ? 'warning'
                : 'muted'
          }
        >
          {t(`state.${balance.state}`)}
        </Badge>
      </p>
      {payments.length > 0 && (
        <ul className="grid gap-1 text-xs">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{p.receiptNumber}</span>
              <span>{tm(p.method)}</span>
              <span>{money(p.amount, p.currency)}</span>
              <span className="text-muted-foreground">
                {format.dateTime(new Date(p.receivedAt), { timeStyle: 'short' })}
              </span>
              {p.pending && <Badge variant="muted">{t('pending')}</Badge>}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void print({
                    payment: p,
                    invoice,
                    lines,
                    patientName,
                    remaining: balance.remaining,
                  })
                }
              >
                <Printer />
                {t('reprint')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {canReceive && balance.remaining > 0 && !session && (
        <p className="text-xs text-warning">{t('openSessionFirst')}</p>
      )}
      {canReceive && balance.remaining > 0 && session && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`pay-method-${invoice.id}`}>{t('method')}</Label>
              <NativeSelect
                id={`pay-method-${invoice.id}`}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {tm(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`pay-currency-${invoice.id}`}>{t('currency')}</Label>
              <NativeSelect
                id={`pay-currency-${invoice.id}`}
                className="w-24"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {[...new Set([invoice.currency, ...accepted])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`pay-received-${invoice.id}`}>{t('received', { currency })}</Label>
              <Input
                id={`pay-received-${invoice.id}`}
                className="w-40"
                inputMode="decimal"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </div>
          </div>
          {method === 'mobile_money' && (
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                aria-label={t('operator')}
                className="w-36"
                value={operator}
                onChange={(e) => setOperator(e.target.value as (typeof MOBILE_OPERATORS)[number])}
              >
                {MOBILE_OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {t(`operators.${o}`)}
                  </option>
                ))}
              </NativeSelect>
              <Input
                aria-label={t('reference')}
                placeholder={t('reference')}
                className="max-w-56"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          )}
          {(method === 'card' || method === 'cheque' || method === 'transfer') && (
            <Input
              aria-label={t('reference')}
              placeholder={t('reference')}
              className="max-w-56"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
          {currency !== invoice.currency && !choice && (
            <p role="alert" className="text-xs text-danger">
              {t('noRate', { from: invoice.currency, to: currency })}
            </p>
          )}
          {choice && (
            <p
              className={
                choice.stale
                  ? 'flex items-center gap-1 text-xs text-warning'
                  : 'text-xs text-muted-foreground'
              }
            >
              {choice.stale && <AlertTriangle className="size-3.5" aria-hidden />}
              {t(choice.stale ? 'staleRate' : 'rate', {
                rate: choice.inverse
                  ? `1 ${currency} = 1/${choice.rate} ${invoice.currency}`
                  : `1 ${invoice.currency} = ${choice.rate} ${currency}`,
                date: choice.validFrom,
              })}
            </p>
          )}
          {q && (
            <p className="text-sm">
              {t('due', { amount: money(q.due, currency) })}
              {q.roundingAdjustment !== 0 && (
                <span className="text-xs text-muted-foreground">
                  {' '}
                  {t('rounding', { amount: money(q.roundingAdjustment, currency) })}
                </span>
              )}
            </p>
          )}
          {outcome && (
            <p className="text-sm">
              {t('settles', { amount: money(outcome.amountInInvoiceCurrency, invoice.currency) })}
              {outcome.change > 0 && (
                <span className="font-medium">
                  {' '}
                  {t('change', { amount: money(outcome.change, currency) })}
                </span>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <Button
            size="sm"
            className="justify-self-start"
            disabled={
              busy || !outcome || (method === 'mobile_money' && reference.trim().length < 3)
            }
            onClick={() => void receive()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Banknote />}
            {t('receive')}
          </Button>
        </div>
      )}
    </div>
  );
}
