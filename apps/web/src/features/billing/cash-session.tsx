'use client';

import { expectedCash, parseAmount, sessionTotals } from '@medhub/domain';
import { AppError, DEFAULT_CURRENCIES } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { Loader2, Lock, LockOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMoney } from './invoice-card';

export type SessionView = {
  id: string;
  openedAt: string;
  openingFloat: Record<string, number>;
  status: string;
};

const digitsOf = (currency: string) => DEFAULT_CURRENCIES[currency]?.minorUnit ?? 2;
const toMajor = (amount: number, currency: string) => String(amount / 10 ** digitsOf(currency));

function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number') out[k] = n;
  }
  return out;
}

export function paymentOf(e: LocalEntity) {
  const d = e.data;
  return {
    id: e.id,
    invoiceId: String(d.invoiceId ?? ''),
    cashSessionId: String(d.cashSessionId ?? ''),
    method: String(d.method ?? 'cash'),
    currency: String(d.currency ?? 'USD'),
    amount: Number(d.amount ?? 0),
    amountInInvoiceCurrency: Number(d.amountInInvoiceCurrency ?? 0),
    invoiceCurrency: String(d.invoiceCurrency ?? 'USD'),
    roundingAdjustment: Number(d.roundingAdjustment ?? 0),
    change: Number(d.change ?? 0),
    exchangeRate: typeof d.exchangeRate === 'string' ? d.exchangeRate : null,
    exchangeRateDate: typeof d.exchangeRateDate === 'string' ? d.exchangeRateDate : null,
    exchangeRateInverse: d.exchangeRateInverse === true,
    reference: typeof d.reference === 'string' ? d.reference : null,
    operator: typeof d.operator === 'string' ? d.operator : null,
    receiptNumber: String(d.receiptNumber ?? ''),
    receivedAt: String(d.receivedAt ?? ''),
    pending: e.version === 0,
  };
}
export type PaymentRow = ReturnType<typeof paymentOf>;

/** The open session of this cashier on this workstation, if any. */
export function useOpenSession(): SessionView | null {
  const { identity, device } = useRuntime();
  const { data } = useLocalQuery(
    async (store) => {
      const rows = (await store.readEntities('cash_session')).filter(
        (e) =>
          !e.rejected &&
          e.data.status === 'open' &&
          e.createdBy === identity?.userId &&
          (e.deviceId === device?.deviceId || !e.deviceId),
      );
      const row = rows.sort((a, b) =>
        String(b.data.openedAt).localeCompare(String(a.data.openedAt)),
      )[0];
      return row
        ? {
            id: row.id,
            openedAt: String(row.data.openedAt),
            openingFloat: numberMap(row.data.openingFloat),
            status: 'open',
          }
        : null;
    },
    [identity?.userId, device?.deviceId],
  );
  return data ?? null;
}

/**
 * Cash session of the cashier on this workstation (docs/modules/fact.md 4):
 * opened with a float per currency, closed once with the cash counted; a
 * variance needs a justification. Offline included.
 */
export function CashSessionBar() {
  const t = useTranslations('billing.session');
  const tErr = useTranslations('errors');
  const money = useMoney();
  const { dispatch, catalogs, identity } = useRuntime();
  const session = useOpenSession();
  const currencies = (
    catalogs?.snapshot.finance?.currencies ?? [
      { currency: 'USD', cashRoundingStep: 0, isAccepted: true },
      { currency: 'CDF', cashRoundingStep: 5000, isAccepted: true },
    ]
  ).filter((c) => c.isAccepted);
  const [float, setFloat] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState('');
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perms = identity?.permissions ?? [];

  const { data: payments } = useLocalQuery(
    async (store) =>
      session
        ? (await store.readEntities('payment'))
            .filter((e) => !e.rejected && e.data.cashSessionId === session.id)
            .map(paymentOf)
        : [],
    [session?.id],
  );
  const expected = session ? expectedCash(session.openingFloat, payments ?? []) : {};
  const totals = sessionTotals(payments ?? []);

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

  if (!perms.includes('cash_session:open') && !session) return null;

  if (!session) {
    const values = Object.fromEntries(
      currencies.map((c) => [
        c.currency,
        parseAmount(float[c.currency] ?? '0', digitsOf(c.currency)),
      ]),
    );
    const valid = Object.values(values).every((v) => v !== null);
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4 text-primary" aria-hidden />
            {t('closedTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-muted-foreground">{t('closedText')}</p>
          <div className="flex flex-wrap items-end gap-3">
            {currencies.map((c) => (
              <div key={c.currency} className="grid gap-1">
                <Label htmlFor={`float-${c.currency}`}>
                  {t('float', { currency: c.currency })}
                </Label>
                <Input
                  id={`float-${c.currency}`}
                  className="w-36"
                  inputMode="decimal"
                  value={float[c.currency] ?? '0'}
                  onChange={(e) => setFloat({ ...float, [c.currency]: e.target.value })}
                />
              </div>
            ))}
            <Button
              disabled={busy || !valid}
              onClick={() =>
                void run(async () => {
                  await dispatch('cash_session.open', {
                    openedAt: new Date().toISOString(),
                    openingFloat: values as Record<string, number>,
                  });
                })
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <LockOpen />}
              {t('open')}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const keys = [...new Set([...currencies.map((c) => c.currency), ...Object.keys(expected)])];
  const countedValues = Object.fromEntries(
    keys.map((k) => [k, parseAmount(counted[k] ?? '', digitsOf(k))]),
  );
  const variance = keys.some((k) => (countedValues[k] ?? 0) !== (expected[k] ?? 0));
  const countsValid = keys.every((k) => countedValues[k] !== null);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockOpen className="size-4 text-success" aria-hidden />
          {t('openTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul className="grid gap-1">
          {Object.entries(totals).map(([method, byCurrency]) => (
            <li key={method}>
              <span className="font-medium">{t(`methods.${method}`)}</span> :{' '}
              {Object.entries(byCurrency)
                .map(([c, a]) => money(a, c))
                .join(' · ')}
            </li>
          ))}
          {Object.keys(totals).length === 0 && (
            <li className="text-muted-foreground">{t('noPayment')}</li>
          )}
        </ul>
        {perms.includes('cash_session:close') && !closing && (
          <Button
            size="sm"
            variant="secondary"
            className="justify-self-start"
            onClick={() => setClosing(true)}
          >
            <Lock />
            {t('close')}
          </Button>
        )}
        {closing && (
          <div className="grid gap-3 rounded-xl bg-muted/50 p-3">
            {keys.map((k) => {
              const value = countedValues[k];
              const diff =
                value === null || value === undefined ? null : value - (expected[k] ?? 0);
              return (
                <div key={k} className="flex flex-wrap items-end gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor={`count-${k}`}>{t('counted', { currency: k })}</Label>
                    <Input
                      id={`count-${k}`}
                      className="w-36"
                      inputMode="decimal"
                      placeholder={toMajor(expected[k] ?? 0, k)}
                      value={counted[k] ?? ''}
                      onChange={(e) => setCounted({ ...counted, [k]: e.target.value })}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t('expected', { amount: money(expected[k] ?? 0, k) })}
                  </span>
                  {diff !== null && diff !== 0 && (
                    <span className="text-xs font-medium text-warning">
                      {t('variance', { amount: money(diff, k) })}
                    </span>
                  )}
                </div>
              );
            })}
            {variance && countsValid && (
              <div className="grid gap-1">
                <Label htmlFor="close-justification">{t('justification')}</Label>
                <Input
                  id="close-justification"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !countsValid || (variance && justification.trim().length < 5)}
                onClick={() =>
                  void run(async () => {
                    await dispatch(
                      'cash_session.close',
                      {
                        status: 'closed',
                        closedAt: new Date().toISOString(),
                        counted: countedValues as Record<string, number>,
                        expected,
                        justification: variance ? justification.trim() : null,
                      },
                      { entityId: session.id },
                    );
                    setClosing(false);
                    setCounted({});
                    setJustification('');
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <Lock />}
                {t('confirmClose')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setClosing(false)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
