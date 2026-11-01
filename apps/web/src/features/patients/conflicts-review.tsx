'use client';

import { Check, Loader2, ShieldAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Conflict = {
  id: string;
  patientId: string;
  patient: string;
  mrn: string;
  serverValue: Record<string, unknown>;
  clientValue: Record<string, unknown>;
  device: string | null;
  createdAt: string;
};

const show = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? '·'
    : typeof v === 'object'
      ? Object.values(v as Record<string, unknown>)
          .filter(Boolean)
          .join(', ')
      : String(v);

/**
 * Changes to sensitive fields made offline on a stale copy (docs/02-offline-sync.md):
 * the value in force was kept, a reviewer decides here.
 */
export function ConflictsReview() {
  const t = useTranslations('patients.conflicts');
  const tf = useTranslations('patient.identityCard.fields');
  const format = useFormatter();
  const online = useOnline();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConflicts(
        (await apiFetch<{ conflicts: Conflict[] }>('/api/v1/patients/conflicts')).conflicts,
      );
    } catch {
      setConflicts([]);
    }
  }, []);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [online, load]);

  async function resolve(conflict: Conflict, choice: 'keep' | 'apply') {
    setBusy(`${conflict.id}-${choice}`);
    setError(null);
    try {
      await apiFetch('/api/v1/patients/conflicts/resolve', {
        method: 'POST',
        body: JSON.stringify({
          conflictId: conflict.id,
          choice,
          reason: reasons[conflict.id] ?? '',
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? t('error') : t('network'));
    } finally {
      setBusy(null);
    }
  }

  if (conflicts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" aria-hidden />
          {t('title', { count: conflicts.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className="text-muted-foreground">{t('intro')}</p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {conflicts.map((c) => {
          const reason = reasons[c.id] ?? '';
          return (
            <div key={c.id} className="grid gap-3 rounded-xl p-3 ring-1 ring-border">
              <p>
                <span className="font-medium">{c.patient}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{c.mrn}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {format.dateTime(new Date(c.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </p>
              {Object.keys(c.clientValue).map((field) => (
                <div key={field} className="grid gap-1 sm:grid-cols-[9rem_1fr_1fr]">
                  <span className="text-muted-foreground">{tf.has(field) ? tf(field) : field}</span>
                  <span>
                    <span className="block text-xs text-muted-foreground">{t('inForce')}</span>
                    {show(c.serverValue[field])}
                  </span>
                  <span>
                    <span className="block text-xs text-muted-foreground">
                      {c.device ? t('fromDevice', { code: c.device }) : t('fromOther')}
                    </span>
                    <span className="font-semibold text-warning">{show(c.clientValue[field])}</span>
                  </span>
                </div>
              ))}
              <div className="grid gap-1.5">
                <Label htmlFor={`conflict-${c.id}`}>{t('reason')}</Label>
                <Input
                  id={`conflict-${c.id}`}
                  value={reason}
                  onChange={(e) => setReasons((r) => ({ ...r, [c.id]: e.target.value }))}
                  placeholder={t('reasonPlaceholder')}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null || !online || reason.trim().length < 3}
                  onClick={() => void resolve(c, 'keep')}
                >
                  {busy === `${c.id}-keep` ? <Loader2 className="animate-spin" /> : <Check />}
                  {t('keep')}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || !online || reason.trim().length < 3}
                  onClick={() => void resolve(c, 'apply')}
                >
                  {busy === `${c.id}-apply` ? <Loader2 className="animate-spin" /> : <Check />}
                  {t('apply')}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
