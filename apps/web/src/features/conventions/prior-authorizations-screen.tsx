'use client';

import { parseAmount } from '@medhub/domain';
import { DEFAULT_CURRENCIES } from '@medhub/shared';
import { Check, Loader2, WifiOff, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStepUp } from '@/features/auth/step-up';
import { useMoney } from '@/features/billing/invoice-card';
import { PageHeader } from '@/features/shell/page-header';

type Request = {
  id: string;
  label: string;
  serviceCode: string | null;
  contractName: string;
  memberName: string;
  memberNumber: string;
  currency: string;
  amountRequested: number;
  reason: string;
  requestedAt: string;
  status: string;
  authorizedAmount: number | null;
  validUntil: string | null;
  payerReference: string | null;
  decisionNote: string | null;
};

type Draft = { amount: string; validUntil: string; reference: string; note: string };

/**
 * Prior authorizations (docs/modules/conv.md, P4 step 4), online: Direction
 * records the payer's answer with a fresh second factor (owner decision S11);
 * the cash desk receives it at its next synchronisation.
 */
export function PriorAuthorizationsScreen() {
  const t = useTranslations('conventions.priorAuthorization');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const money = useMoney();
  const online = useOnline();
  const { syncNow } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<{ requests: Request[]; canDecide: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch('/api/v1/prior-authorizations'));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    }
  }, [tErr]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  function draftOf(r: Request): Draft {
    const digits = DEFAULT_CURRENCIES[r.currency]?.minorUnit ?? 2;
    return (
      drafts[r.id] ?? {
        amount: (r.amountRequested / 10 ** digits).toFixed(digits),
        validUntil: '',
        reference: '',
        note: '',
      }
    );
  }

  function edit(r: Request, patch: Partial<Draft>) {
    setDrafts({ ...drafts, [r.id]: { ...draftOf(r), ...patch } });
  }

  async function decide(r: Request, approve: boolean) {
    const d = draftOf(r);
    const digits = DEFAULT_CURRENCIES[r.currency]?.minorUnit ?? 2;
    setBusy(r.id);
    setError(null);
    try {
      await guard(() =>
        apiFetch('/api/v1/prior-authorizations/decide', {
          method: 'POST',
          body: JSON.stringify({
            id: r.id,
            approve,
            authorizedAmount: approve ? parseAmount(d.amount, digits) : null,
            validUntil: approve ? d.validUntil || null : null,
            payerReference: d.reference.trim() || null,
            note: d.note.trim() || null,
          }),
        }),
      );
      await refresh();
      syncNow();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {!online && !view && (
        <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t('offline')}</p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {view && view.requests.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}
      <ul className="grid gap-3">
        {(view?.requests ?? []).map((r) => {
          const d = draftOf(r);
          return (
            <li key={r.id}>
              <Card>
                <CardContent className="grid gap-2 p-4 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.label}</span>
                    {r.serviceCode && <span className="font-mono text-xs">{r.serviceCode}</span>}
                    <span>{money(r.amountRequested, r.currency)}</span>
                    <Badge
                      variant={
                        r.status === 'pending'
                          ? 'warning'
                          : r.status === 'approved'
                            ? 'info'
                            : 'muted'
                      }
                    >
                      {t(`status.${r.status}`)}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.contractName} · {r.memberName} ({r.memberNumber}) ·{' '}
                    {format.dateTime(new Date(r.requestedAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                  <p>{r.reason}</p>
                  {r.status === 'approved' && (
                    <p className="text-xs">
                      {t('approved', {
                        amount: money(r.authorizedAmount ?? 0, r.currency),
                        date: r.validUntil ?? '',
                      })}
                      {r.payerReference ? ` · ${r.payerReference}` : ''}
                    </p>
                  )}
                  {r.status === 'rejected' && (
                    <p className="text-xs">{t('rejected', { note: r.decisionNote ?? '' })}</p>
                  )}
                  {r.status === 'pending' && view?.canDecide && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`amount-${r.id}`}>
                          {t('authorizedAmount', { currency: r.currency })}
                        </Label>
                        <Input
                          id={`amount-${r.id}`}
                          inputMode="decimal"
                          value={d.amount}
                          onChange={(e) => edit(r, { amount: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`until-${r.id}`}>{t('validUntil')}</Label>
                        <Input
                          id={`until-${r.id}`}
                          type="date"
                          value={d.validUntil}
                          onChange={(e) => edit(r, { validUntil: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`ref-${r.id}`}>{t('payerReference')}</Label>
                        <Input
                          id={`ref-${r.id}`}
                          value={d.reference}
                          onChange={(e) => edit(r, { reference: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`note-${r.id}`}>{t('note')}</Label>
                        <Input
                          id={`note-${r.id}`}
                          value={d.note}
                          onChange={(e) => edit(r, { note: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <Button
                          size="sm"
                          disabled={
                            busy !== null ||
                            !d.validUntil ||
                            parseAmount(
                              d.amount,
                              DEFAULT_CURRENCIES[r.currency]?.minorUnit ?? 2,
                            ) === null
                          }
                          onClick={() => void decide(r, true)}
                        >
                          {busy === r.id ? <Loader2 className="animate-spin" /> : <Check />}
                          {t('approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy !== null || d.note.trim().length < 3}
                          onClick={() => void decide(r, false)}
                        >
                          <X />
                          {t('reject')}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
      {dialog}
    </div>
  );
}
