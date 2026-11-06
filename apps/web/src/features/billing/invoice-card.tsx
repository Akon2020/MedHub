'use client';

import { canFinalize, lineAmount, lineFor, parseAmount, type ServiceItem } from '@medhub/domain';
import { AppError, DEFAULT_CURRENCIES, formatMoney } from '@medhub/shared';
import { Check, FileCheck2, Loader2, Plus, Receipt } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { localDay } from '@/features/visits/visit-helpers';
import { totalsOf, type InvoiceLineView, type InvoiceView } from './billing-helpers';
import { addLine, type BillingContext } from './visit-billing';

export function useMoney() {
  const locale = useLocale();
  return (amount: number, currency: string) =>
    formatMoney({ amount, currency }, locale === 'en' ? 'en-US' : 'fr-CD');
}

/**
 * One invoice at the cash desk (docs/modules/fact.md section 2): its lines,
 * the lines still waiting for a price, manual lines and finalization. Works
 * offline; a finalized invoice no longer changes.
 */
export function InvoiceCard({
  invoice,
  lines,
  children,
}: {
  invoice: InvoiceView;
  lines: InvoiceLineView[];
  children?: React.ReactNode;
}) {
  const t = useTranslations('billing.invoice');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const money = useMoney();
  const { dispatch, nextCounter, catalogs, identity, device } = useRuntime();
  const finance = catalogs?.snapshot.finance;
  const perms = identity?.permissions ?? [];
  const canAdd = perms.includes('invoice:add_line') && invoice.status === 'open';
  const canPrice = perms.includes('price:manage') && invoice.status === 'open';
  const canClose = perms.includes('invoice:finalize') && invoice.status === 'open';
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [manual, setManual] = useState('');
  const [pricing, setPricing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = lines.filter((l) => l.status !== 'superseded');
  const totals = totalsOf(lines);
  const digits = DEFAULT_CURRENCIES[invoice.currency]?.minorUnit ?? 2;
  const services = (finance?.serviceItems ?? []).filter((s) => s.isActive);
  const matches =
    query.trim().length >= 2
      ? services
          .filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  const ctx: BillingContext = {
    dispatch,
    nextCounter,
    finance,
    siteCode: identity?.siteCode ?? 'SIT',
    deviceCode: device?.deviceCode ?? 'XX',
    permissions: perms,
  };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  function addService(service: ServiceItem) {
    void run(async () => {
      if (!finance) return;
      const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
      const line = lineFor(service, localDay(new Date()), finance, invoice.currency, qty);
      if (line.unitPrice !== null && line.currency !== invoice.currency) {
        throw new AppError('FACT_CURRENCY_MISMATCH');
      }
      await addLine(ctx, {
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        line: { ...line, currency: invoice.currency },
      });
      setQuery('');
      setQuantity('1');
    });
  }

  function setPrice(target: InvoiceLineView, event: FormEvent) {
    event.preventDefault();
    const amount = parseAmount(manual, digits);
    if (amount === null) return;
    void run(async () => {
      await addLine(ctx, {
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        line: {
          serviceItemId: target.serviceItemId,
          code: target.code,
          label: target.label,
          category: target.category as ServiceItem['category'],
          quantity: target.quantity,
          unitPrice: amount,
          currency: invoice.currency,
          priceListId: null,
        },
        supersedesId: target.id,
        manualPrice: true,
      });
      setPricing(null);
      setManual('');
    });
  }

  function finalize() {
    void run(async () => {
      await dispatch(
        'invoice.finalize',
        { status: 'finalized', finalizedAt: new Date().toISOString() },
        { entityId: invoice.id },
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Receipt className="size-4 text-primary" aria-hidden />
          <span className="font-mono">{invoice.number}</span>
          <Badge variant={invoice.status === 'open' ? 'info' : 'muted'}>
            {t(`status.${invoice.status}`)}
          </Badge>
          {invoice.supplementaryOf && <Badge variant="warning">{t('supplementary')}</Badge>}
          {invoice.pending && <Badge variant="muted">{t('pending')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t('opened', {
            date: format.dateTime(new Date(invoice.openedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
        {shown.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
        <ul className="grid gap-1.5">
          {shown.map((l) => (
            <li key={l.id} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.label}</span>
                  {l.quantity > 1 && <span className="text-muted-foreground"> × {l.quantity}</span>}
                  {l.manualPrice && (
                    <span className="ml-1 text-xs text-warning">{t('manual')}</span>
                  )}
                </span>
                {l.unitPrice === null ? (
                  <Badge variant="warning">{t('noPrice')}</Badge>
                ) : (
                  <span className="font-mono">{money(lineAmount(l), invoice.currency)}</span>
                )}
                {l.unitPrice === null && canPrice && pricing !== l.id && (
                  <Button size="sm" variant="ghost" onClick={() => setPricing(l.id)}>
                    {t('setPrice')}
                  </Button>
                )}
              </div>
              {pricing === l.id && (
                <form onSubmit={(e) => setPrice(l, e)} className="flex flex-wrap gap-2">
                  <Input
                    aria-label={t('unitPrice', { currency: invoice.currency })}
                    placeholder={t('unitPrice', { currency: invoice.currency })}
                    className="max-w-40"
                    inputMode="decimal"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || parseAmount(manual, digits) === null}
                  >
                    <Check />
                    {t('confirmPrice')}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <p
          className={cn(
            'flex items-center justify-between border-t border-border pt-2 font-semibold',
            totals.missingPrices > 0 && 'text-warning',
          )}
        >
          <span>{t('total')}</span>
          <span className="font-mono">{money(totals.gross, invoice.currency)}</span>
        </p>
        {totals.missingPrices > 0 && (
          <p role="status" className="text-xs text-warning">
            {t('missing', { count: totals.missingPrices })}
          </p>
        )}
        {canAdd && (
          <div className="grid gap-2 rounded-xl bg-muted/50 p-3">
            <Label htmlFor={`add-${invoice.id}`}>{t('addService')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`add-${invoice.id}`}
                className="min-w-0 flex-1"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Input
                aria-label={t('quantity')}
                className="w-20"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            {matches.length > 0 && (
              <ul className="grid gap-1">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => addService(m)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      <span className="font-mono text-xs">{m.code}</span> {m.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canClose && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !canFinalize(lines)}
              onClick={finalize}
            >
              {busy ? <Loader2 className="animate-spin" /> : <FileCheck2 />}
              {t('finalize')}
            </Button>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
