'use client';

import { parseAmount } from '@medhub/domain';
import { DEFAULT_CURRENCIES } from '@medhub/shared';
import { Loader2, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { useMoney } from '@/features/billing/invoice-card';

type Row = {
  id: string;
  memberNumber: string | null;
  kind: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  recordedAt: string;
};
type View = { rows: Row[]; balance: { total: number; byMember: Record<string, number> } };

const METHODS = ['transfer', 'cash', 'cheque', 'mobile_money'] as const;

/**
 * Guarantees held for a contract (docs/modules/conv.md 5), online: received
 * when the contract starts, refunded at termination, never more than held.
 */
export function GuaranteesCard({
  contractId,
  currency,
  guard,
}: {
  contractId: string;
  currency: string;
  guard: <T>(call: () => Promise<T>) => Promise<T>;
}) {
  const t = useTranslations('conventions.guarantees');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const money = useMoney();
  const { identity } = useRuntime();
  const canRecord = (identity?.permissions ?? []).includes('payer_invoice:record_payment');
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState({
    memberNumber: '',
    kind: 'receive' as 'receive' | 'refund',
    amount: '',
    method: 'transfer' as (typeof METHODS)[number],
    reference: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = DEFAULT_CURRENCIES[currency]?.minorUnit ?? 2;

  const describe = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      return tErr.has(code) ? tErr(code) : tErr('UNKNOWN');
    },
    [tErr],
  );
  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch<View>(`/api/v1/guarantees?contract=${contractId}`));
    } catch (err) {
      setError(describe(err));
    }
  }, [contractId, describe]);

  useEffect(() => {
    // Loading when the selected contract changes is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = parseAmount(form.amount, digits);
    if (amount === null || amount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await guard(() =>
        apiFetch('/api/v1/guarantees', {
          method: 'POST',
          body: JSON.stringify({
            contractId,
            memberNumber: form.memberNumber.trim() || null,
            kind: form.kind,
            amount,
            currency,
            method: form.method,
            reference: form.reference.trim() || null,
          }),
        }),
      );
      setForm({ ...form, amount: '', reference: '' });
      await refresh();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {!view ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <>
            <p className="font-medium">
              {t('held', { amount: money(view.balance.total, currency) })}
            </p>
            {view.rows.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
            <ul className="grid gap-1">
              {view.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.kind === 'refund' ? 'warning' : 'info'}>
                    {t(`kinds.${r.kind}`)}
                  </Badge>
                  <span className="font-mono">{money(r.amount, r.currency)}</span>
                  {r.memberNumber && <span className="font-mono text-xs">{r.memberNumber}</span>}
                  <span className="text-xs text-muted-foreground">
                    {t(`methods.${r.method}`)}
                    {r.reference ? ` · ${r.reference}` : ''} ·{' '}
                    {format.dateTime(new Date(r.recordedAt), { dateStyle: 'medium' })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {canRecord && (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="guarantee-kind">{t('kind')}</Label>
              <NativeSelect
                id="guarantee-kind"
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value === 'refund' ? 'refund' : 'receive' })
                }
              >
                <option value="receive">{t('kinds.receive')}</option>
                <option value="refund">{t('kinds.refund')}</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="guarantee-member">{t('memberNumber')}</Label>
              <Input
                id="guarantee-member"
                className="w-32"
                value={form.memberNumber}
                onChange={(e) => setForm({ ...form, memberNumber: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="guarantee-amount">{t('amount', { currency })}</Label>
              <Input
                id="guarantee-amount"
                className="w-32"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="guarantee-method">{t('method')}</Label>
              <NativeSelect
                id="guarantee-method"
                value={form.method}
                onChange={(e) =>
                  setForm({
                    ...form,
                    method: METHODS.find((m) => m === e.target.value) ?? 'transfer',
                  })
                }
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`methods.${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="guarantee-ref">{t('reference')}</Label>
              <Input
                id="guarantee-ref"
                className="w-36"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={busy || parseAmount(form.amount, digits) === null}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {t('record')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
