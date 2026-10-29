'use client';

import { DEFAULT_VITAL_SIGN_DEFINITIONS, checkVitalPlausibility } from '@medhub/domain';
import { AppError, type VitalSignCode } from '@medhub/shared';
import { Activity, AlertTriangle, Loader2, Pencil, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type VitalView = {
  id: string;
  code: VitalSignCode;
  value: number;
  unit: string;
  measuredAt: string;
  status: string;
  pending: boolean;
  overrideReason: string | null;
};

const COMMON_CODES: VitalSignCode[] = [
  'temp',
  'pulse',
  'sbp',
  'dbp',
  'rr',
  'spo2',
  'weight',
  'height',
  'glucose',
];

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function VitalsPanel({ patientId, vitals }: { patientId: string; vitals: VitalView[] }) {
  const t = useTranslations('patient.vitals');
  const tErr = useTranslations('errors');
  const tc = useTranslations('common');
  const tp = useTranslations('patients.state');
  const format = useFormatter();
  const { dispatch } = useRuntime();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<VitalSignCode>('temp');
  const [value, setValue] = useState('');
  const [measuredAt, setMeasuredAt] = useState(() => localDateTimeValue(new Date()));
  const [reason, setReason] = useState('');
  const [supersedes, setSupersedes] = useState<VitalView | null>(null);
  const [needsReason, setNeedsReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const definition = DEFAULT_VITAL_SIGN_DEFINITIONS.find((d) => d.code === code);

  function startCorrection(vital: VitalView) {
    setSupersedes(vital);
    setCode(vital.code);
    setValue(String(vital.value));
    setMeasuredAt(localDateTimeValue(new Date(vital.measuredAt)));
    setOpen(true);
  }

  function reset() {
    setOpen(false);
    setSupersedes(null);
    setValue('');
    setReason('');
    setNeedsReason(false);
    setError(null);
    setMeasuredAt(localDateTimeValue(new Date()));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(value.replace(',', '.'));
    if (!Number.isFinite(numeric) || value.trim() === '')
      return setError(tErr('VALIDATION_FAILED'));
    const plausibility = checkVitalPlausibility({
      code,
      value: numeric,
      plausibilityOverrideReason: reason.trim() || null,
    });
    if (!plausibility.ok) {
      setNeedsReason(true);
      return setError(tErr('DPI_VITAL_IMPLAUSIBLE'));
    }
    setBusy(true);
    setError(null);
    try {
      await dispatch('vital_sign.record', {
        patientId,
        code,
        value: numeric,
        unit: definition?.unit ?? '',
        measuredAt: new Date(measuredAt).toISOString(),
        supersedesId: supersedes?.id ?? null,
        plausibilityOverrideReason: reason.trim() || null,
      });
      reset();
    } catch (err) {
      const key = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(key) ? tErr(key) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus />
            {t('record')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {open && (
          <form
            onSubmit={onSubmit}
            className="mb-5 grid gap-4 rounded-2xl bg-muted/60 p-4 ring-1 ring-border"
          >
            {supersedes && (
              <p className="text-sm text-slate-ink">
                {t('correcting', {
                  date: format.dateTime(new Date(supersedes.measuredAt), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                })}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="vital-code">{t('code')}</Label>
                <select
                  id="vital-code"
                  value={code}
                  disabled={Boolean(supersedes)}
                  onChange={(e) => setCode(e.target.value as VitalSignCode)}
                  className="h-11 rounded-lg border border-input bg-white px-3 text-[15px] outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/25"
                >
                  {COMMON_CODES.map((c) => (
                    <option key={c} value={c}>
                      {t(`codes.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vital-value">
                  {t('value')} {definition ? `(${definition.unit})` : ''}
                </Label>
                <Input
                  id="vital-value"
                  inputMode="decimal"
                  value={value}
                  autoFocus
                  onChange={(e) => {
                    setValue(e.target.value);
                    setNeedsReason(false);
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vital-at">{t('measuredAt')}</Label>
                <Input
                  id="vital-at"
                  type="datetime-local"
                  value={measuredAt}
                  onChange={(e) => setMeasuredAt(e.target.value)}
                />
              </div>
            </div>
            {needsReason && (
              <div className="grid gap-2">
                <Label htmlFor="vital-reason">{t('override')}</Label>
                <Input
                  id="vital-reason"
                  value={reason}
                  placeholder={t('overridePlaceholder')}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={reset}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {t('record')}
              </Button>
            </div>
          </form>
        )}

        {vitals.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {vitals.map((v) => {
              const superseded = v.status === 'superseded';
              return (
                <li key={v.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        superseded && 'text-muted-foreground line-through',
                      )}
                    >
                      {t(`codes.${v.code}`)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(v.measuredAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <p
                    className={cn(
                      'font-display text-lg font-semibold tabular-nums',
                      superseded && 'text-muted-foreground line-through',
                    )}
                  >
                    {format.number(v.value, { maximumFractionDigits: 2 })}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">{v.unit}</span>
                  </p>
                  {superseded && <Badge variant="muted">{t('superseded')}</Badge>}
                  {v.overrideReason && (
                    <Badge variant="warning" title={v.overrideReason}>
                      <AlertTriangle aria-label={t('override')} />
                    </Badge>
                  )}
                  {v.pending && (
                    <span
                      className="size-2 rounded-full bg-warning"
                      title={tp('pending')}
                      aria-label={tp('pending')}
                    />
                  )}
                  {!superseded && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => startCorrection(v)}
                      aria-label={t('correct')}
                    >
                      <Pencil />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
