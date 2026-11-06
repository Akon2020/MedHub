'use client';

import {
  PRICE_LIST_KINDS,
  SERVICE_CATEGORIES,
  parseAmount,
  type Price,
  type PriceList,
  type PriceListKind,
  type ServiceCategory,
  type ServiceItem,
} from '@medhub/domain';
import { DEFAULT_CURRENCIES, formatMoney } from '@medhub/shared';
import { Check, Loader2, Plus, WifiOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { useStepUp } from '@/features/auth/step-up';
import { CatalogImport } from './diagnosis-catalog-settings';

type Overview = {
  serviceItems: ServiceItem[];
  priceLists: PriceList[];
  prices: Price[];
  exchangeRates: { from: string; to: string; rate: string; validFrom: string }[];
  currencies: { currency: string; cashRoundingStep: number; isAccepted: boolean }[];
  canManage: boolean;
};

const minorUnit = (currency: string) => DEFAULT_CURRENCIES[currency]?.minorUnit ?? 2;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Pricing of the structure (docs/modules/fact.md section 1), online: accepted
 * currencies and cash rounding, rate of the day, services and price lists with
 * dated prices. Workstations receive them with their catalogs.
 */
export function FinanceSettings() {
  const t = useTranslations('settings.finance');
  const tErr = useTranslations('errors');
  const locale = useLocale();
  const online = useOnline();
  const { reloadCatalogs } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState({ from: 'USD', to: 'CDF', rate: '', validFrom: today() });
  const [service, setService] = useState({
    code: '',
    name: '',
    category: 'consultation' as ServiceCategory,
  });
  const [list, setList] = useState({
    code: '',
    name: '',
    kind: 'public' as PriceListKind,
    currency: 'USD',
  });
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [rounding, setRounding] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const out = await apiFetch<Overview>('/api/v1/finance');
      setView(out);
      setSelectedList((s) => s ?? out.priceLists[0]?.id ?? null);
    } catch (err) {
      setError(
        tErr.has(err instanceof ApiError ? err.code : 'UNKNOWN')
          ? tErr(err instanceof ApiError ? err.code : 'UNKNOWN')
          : tErr('UNKNOWN'),
      );
    }
  }, [tErr]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function send(path: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await guard(() => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }));
      setNotice(done);
      await refresh();
      await reloadCatalogs();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  if (!online && !view) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!view) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
    );
  }

  const canManage = view.canManage;
  const current = view.priceLists.find((l) => l.id === selectedList) ?? null;
  const fmt = (amount: number, currency: string) =>
    formatMoney({ amount, currency }, locale === 'en' ? 'en-US' : 'fr-CD');
  const listPrices = current
    ? view.prices
        .filter((p) => p.priceListId === current.id)
        .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
    : [];

  return (
    <div className="grid gap-6">
      {notice && (
        <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('currencies.title')}</CardTitle>
          <CardDescription>{t('currencies.text')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {view.currencies.map((c) => {
            const digits = minorUnit(c.currency);
            const shown = rounding[c.currency] ?? String(c.cashRoundingStep / 10 ** digits);
            return (
              <div key={c.currency} className="flex flex-wrap items-end gap-3">
                <span className="w-12 font-mono font-medium">{c.currency}</span>
                <div className="grid gap-1">
                  <Label htmlFor={`round-${c.currency}`}>{t('currencies.rounding')}</Label>
                  <Input
                    id={`round-${c.currency}`}
                    className="w-32"
                    inputMode="decimal"
                    disabled={!canManage}
                    value={shown}
                    onChange={(e) => setRounding({ ...rounding, [c.currency]: e.target.value })}
                  />
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || parseAmount(shown, digits) === null}
                    onClick={() =>
                      void send(
                        '/api/v1/currencies',
                        {
                          currency: c.currency,
                          cashRoundingStep: parseAmount(shown, digits) ?? 0,
                          isAccepted: c.isAccepted,
                        },
                        t('saved'),
                      )
                    }
                  >
                    <Check />
                    {t('save')}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('rates.title')}</CardTitle>
          <CardDescription>{t('rates.text')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {canManage && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void send(
                  '/api/v1/exchange-rates',
                  { ...rate, rate: rate.rate.replace(',', '.') },
                  t('saved'),
                );
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor="rate-from">{t('rates.from')}</Label>
                <NativeSelect
                  id="rate-from"
                  className="w-24"
                  value={rate.from}
                  onChange={(e) => setRate({ ...rate, from: e.target.value })}
                >
                  {view.currencies.map((c) => (
                    <option key={c.currency}>{c.currency}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="rate-value">{t('rates.value')}</Label>
                <Input
                  id="rate-value"
                  className="w-36"
                  inputMode="decimal"
                  value={rate.rate}
                  onChange={(e) => setRate({ ...rate, rate: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="rate-to">{t('rates.to')}</Label>
                <NativeSelect
                  id="rate-to"
                  className="w-24"
                  value={rate.to}
                  onChange={(e) => setRate({ ...rate, to: e.target.value })}
                >
                  {view.currencies.map((c) => (
                    <option key={c.currency}>{c.currency}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="rate-day">{t('rates.day')}</Label>
                <Input
                  id="rate-day"
                  type="date"
                  className="w-40"
                  value={rate.validFrom}
                  onChange={(e) => setRate({ ...rate, validFrom: e.target.value })}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !/^\d+([.,]\d{1,6})?$/.test(rate.rate) || rate.from === rate.to}
              >
                <Check />
                {t('rates.save')}
              </Button>
            </form>
          )}
          {view.exchangeRates.length === 0 ? (
            <p className="text-muted-foreground">{t('rates.none')}</p>
          ) : (
            <ul className="grid gap-1">
              {view.exchangeRates.slice(0, 10).map((r) => (
                <li key={`${r.from}-${r.to}-${r.validFrom}`} className="font-mono text-xs">
                  {r.validFrom} : 1 {r.from} = {r.rate} {r.to}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('serviceCard.title')}</CardTitle>
          <CardDescription>
            {t('serviceCard.text', { count: view.serviceItems.length })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ul className="grid max-h-64 gap-1 overflow-auto">
            {view.serviceItems.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{s.code}</span>
                <span>{s.name}</span>
                <Badge variant="muted">{t(`categories.${s.category}`)}</Badge>
                {!s.isActive && <Badge variant="warning">{t('inactive')}</Badge>}
              </li>
            ))}
          </ul>
          {canManage && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void send('/api/v1/service-items', { ...service, isActive: true }, t('saved'));
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor="svc-code">{t('code')}</Label>
                <Input
                  id="svc-code"
                  className="w-32"
                  value={service.code}
                  onChange={(e) => setService({ ...service, code: e.target.value })}
                />
              </div>
              <div className="grid min-w-48 flex-1 gap-1">
                <Label htmlFor="svc-name">{t('name')}</Label>
                <Input
                  id="svc-name"
                  value={service.name}
                  onChange={(e) => setService({ ...service, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="svc-cat">{t('category')}</Label>
                <NativeSelect
                  id="svc-cat"
                  value={service.category}
                  onChange={(e) =>
                    setService({ ...service, category: e.target.value as ServiceCategory })
                  }
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={busy || service.code.trim() === '' || service.name.trim().length < 2}
              >
                <Plus />
                {t('add')}
              </Button>
            </form>
          )}
          {canManage && (
            <CatalogImport
              endpoint="/api/v1/service-items/import"
              namespace="settings.finance.services"
              known={view.serviceItems.length}
              onDone={() => void refresh()}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('lists.title')}</CardTitle>
          <CardDescription>{t('lists.text')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {view.priceLists.map((l) => (
              <Button
                key={l.id}
                size="sm"
                variant={l.id === selectedList ? 'default' : 'secondary'}
                onClick={() => setSelectedList(l.id)}
              >
                {l.name} · {l.currency}
              </Button>
            ))}
          </div>
          {canManage && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void send('/api/v1/price-lists', { ...list, isActive: true }, t('saved'));
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor="list-code">{t('code')}</Label>
                <Input
                  id="list-code"
                  className="w-28"
                  value={list.code}
                  onChange={(e) => setList({ ...list, code: e.target.value })}
                />
              </div>
              <div className="grid min-w-40 flex-1 gap-1">
                <Label htmlFor="list-name">{t('name')}</Label>
                <Input
                  id="list-name"
                  value={list.name}
                  onChange={(e) => setList({ ...list, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="list-kind">{t('kind')}</Label>
                <NativeSelect
                  id="list-kind"
                  value={list.kind}
                  onChange={(e) => setList({ ...list, kind: e.target.value as PriceListKind })}
                >
                  {PRICE_LIST_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="list-cur">{t('currency')}</Label>
                <NativeSelect
                  id="list-cur"
                  className="w-24"
                  value={list.currency}
                  onChange={(e) => setList({ ...list, currency: e.target.value })}
                >
                  {view.currencies.map((c) => (
                    <option key={c.currency}>{c.currency}</option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={busy || list.code.trim() === '' || list.name.trim().length < 2}
              >
                <Plus />
                {t('addList')}
              </Button>
            </form>
          )}
          {current && (
            <>
              {listPrices.length === 0 ? (
                <p className="text-muted-foreground">{t('lists.empty')}</p>
              ) : (
                <ul className="grid max-h-64 gap-1 overflow-auto">
                  {listPrices.map((p) => {
                    const s = view.serviceItems.find((x) => x.id === p.serviceItemId);
                    return (
                      <li
                        key={`${p.serviceItemId}-${p.validFrom}`}
                        className="flex flex-wrap gap-2"
                      >
                        <span className="font-mono text-xs">{s?.code}</span>
                        <span>{s?.name}</span>
                        <span className="font-medium">{fmt(p.amount, p.currency)}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.validUntil
                            ? t('period', { from: p.validFrom, until: p.validUntil })
                            : t('since', { from: p.validFrom })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canManage && (
                <CatalogImport
                  key={current.id}
                  endpoint="/api/v1/prices/import"
                  namespace="settings.finance.prices"
                  known={listPrices.length}
                  extra={{ priceListId: current.id }}
                  onDone={() => void refresh()}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
      {dialog}
    </div>
  );
}
