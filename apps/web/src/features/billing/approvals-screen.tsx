'use client';

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
import { useStepUp } from '@/features/auth/step-up';
import { PageHeader } from '@/features/shell/page-header';
import { useMoney } from './invoice-card';

type Request = {
  id: string;
  kind: string;
  invoiceNumber: string;
  patientName: string;
  currency: string;
  amount: number;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  requesterId: string | null;
  status: string;
  decidedBy: string | null;
  decisionReason: string | null;
};

/**
 * Four-eyes queue (owner decision S10), online: discounts and credit notes
 * asked at the cash desk, decided by another authorised user with a fresh
 * second factor. The decision reaches the workstations at their next sync.
 */
export function ApprovalsScreen() {
  const t = useTranslations('billing.approvals');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const money = useMoney();
  const online = useOnline();
  const { identity, syncNow } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<{ requests: Request[]; canDecide: boolean } | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch('/api/v1/approvals'));
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

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    try {
      await guard(() =>
        apiFetch('/api/v1/approvals/decide', {
          method: 'POST',
          body: JSON.stringify({ id, approve, reason: reasons[id]?.trim() || null }),
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
          const own = r.requesterId === identity?.userId;
          return (
            <li key={r.id}>
              <Card>
                <CardContent className="grid gap-2 p-4 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge variant={r.kind === 'credit_note' ? 'warning' : 'info'}>
                      {t(`kinds.${r.kind}`)}
                    </Badge>
                    <span className="font-semibold">{money(r.amount, r.currency)}</span>
                    <span className="font-mono text-xs">{r.invoiceNumber}</span>
                    <span>{r.patientName}</span>
                    <Badge variant={r.status === 'pending' ? 'warning' : 'muted'}>
                      {t(`status.${r.status}`)}
                    </Badge>
                  </p>
                  <p>{r.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('asked', {
                      name: r.requestedBy,
                      date: format.dateTime(new Date(r.requestedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                    {r.decidedBy ? ` · ${t('decidedBy', { name: r.decidedBy })}` : ''}
                    {r.decisionReason ? ` · ${r.decisionReason}` : ''}
                  </p>
                  {r.status === 'pending' && view?.canDecide && !own && (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label={t('reason')}
                        placeholder={t('reason')}
                        className="min-w-0 flex-1"
                        value={reasons[r.id] ?? ''}
                        onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
                      />
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void decide(r.id, true)}
                      >
                        {busy === r.id ? <Loader2 className="animate-spin" /> : <Check />}
                        {t('approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null || (reasons[r.id] ?? '').trim().length < 3}
                        onClick={() => void decide(r.id, false)}
                      >
                        <X />
                        {t('reject')}
                      </Button>
                    </div>
                  )}
                  {r.status === 'pending' && own && (
                    <p className="text-xs text-muted-foreground">{t('ownRequest')}</p>
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
