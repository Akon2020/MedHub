'use client';

import { CheckCircle2, GitMerge, Loader2, WifiOff, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Patient = {
  id: string;
  mrn: string;
  familyName: string;
  middleName: string | null;
  givenName: string | null;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
  createdAt: string;
};

type Pair = {
  id: string;
  score: number;
  reasons: string[];
  createdAt: string;
  a: Patient;
  b: Patient;
};

const FIELDS = ['name', 'sex', 'birthDate', 'phone', 'mrn', 'createdAt'] as const;
type Field = (typeof FIELDS)[number];

function PairCard({ pair, onDismissed }: { pair: Pair; onDismissed: () => Promise<void> }) {
  const t = useTranslations('patients.queue');
  const tp = useTranslations('patients');
  const format = useFormatter();
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = (p: Patient, field: Field): string => {
    switch (field) {
      case 'name':
        return [p.familyName, p.middleName, p.givenName].filter(Boolean).join(' ');
      case 'sex':
        return tp(`sex.${p.sex === 'M' || p.sex === 'F' ? p.sex : 'U'}`);
      case 'birthDate':
        if (!p.birthDate) return '';
        return p.birthDateEstimated
          ? t('estimatedYear', { year: p.birthDate.slice(0, 4) })
          : format.dateTime(new Date(`${p.birthDate}T00:00:00`), { dateStyle: 'medium' });
      case 'phone':
        return p.phone ?? '';
      case 'mrn':
        return p.mrn;
      case 'createdAt':
        return format.dateTime(new Date(p.createdAt), { dateStyle: 'medium', timeStyle: 'short' });
    }
  };

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/patients/duplicates/dismiss', {
        method: 'POST',
        body: JSON.stringify({ candidateId: pair.id, reason }),
      });
      await onDismissed();
    } catch (err) {
      setError(err instanceof ApiError ? t('error') : t('network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={pair.score >= 90 ? 'danger' : 'warning'}>
            {t('score', { score: pair.score })}
          </Badge>
          {pair.reasons
            .filter((r) => r !== 'sex_differs')
            .map((r) => (
              <Badge key={r} variant="muted">
                {tp(`duplicates.reasons.${r}`)}
              </Badge>
            ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="w-36 py-1.5 font-medium" />
                <th className="py-1.5 font-medium">{t('recordA')}</th>
                <th className="py-1.5 font-medium">{t('recordB')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FIELDS.map((field) => {
                const a = value(pair.a, field);
                const b = value(pair.b, field);
                return (
                  <tr key={field}>
                    <th
                      scope="row"
                      className="py-2 pr-3 text-left font-normal text-muted-foreground"
                    >
                      {t(`fields.${field}`)}
                    </th>
                    {[a, b].map((v, i) => (
                      <td
                        key={i}
                        className={cn(
                          'py-2 pr-3',
                          field !== 'mrn' &&
                            field !== 'createdAt' &&
                            a !== b &&
                            'font-semibold text-warning',
                        )}
                      >
                        {v || '·'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open ? (
          <div className="grid gap-2 rounded-xl p-3 ring-1 ring-border">
            <Label htmlFor={`reason-${pair.id}`}>{t('reason')}</Label>
            <Input
              id={`reason-${pair.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || !online || reason.trim().length < 3}
                onClick={() => void dismiss()}
              >
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {t('dismissConfirm')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!online} onClick={() => setOpen(true)}>
              <XCircle />
              {t('dismiss')}
            </Button>
            <Button size="sm" variant="secondary" disabled title={t('mergeSoon')}>
              <GitMerge />
              {t('merge')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Online-only screen: pairs of records the server found similar (scenario P3). */
export function DuplicatesQueue() {
  const t = useTranslations('patients.queue');
  const online = useOnline();
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPairs((await apiFetch<{ pairs: Pair[] }>('/api/v1/patients/duplicates')).pairs);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PERMISSION_DENIED' ? t('denied') : t('network'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  if (!online && !pairs) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!pairs) {
    return error ? (
      <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {pairs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        pairs.map((pair) => <PairCard key={pair.id} pair={pair} onDismissed={refresh} />)
      )}
    </div>
  );
}
