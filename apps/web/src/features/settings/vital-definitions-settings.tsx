'use client';

import type { NormalRange } from '@medhub/domain';
import type { VitalSignCode } from '@medhub/shared';
import { Check, Loader2, Plus, Trash2, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { useStepUp } from '@/features/auth/step-up';

type Definition = {
  code: VitalSignCode;
  unit: string;
  plausibleMin: number;
  plausibleMax: number;
  stabilityMargin: number | null;
  normalRanges: NormalRange[];
  configured: boolean;
};

type RangeDraft = { sex: string; ageMin: string; ageMax: string; low: string; high: string };

const num = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? null : n;
};

/**
 * Vital sign settings of the structure (docs/modules/dpi.md section 3). The
 * normal ranges are clinical references chosen by the structure: none is
 * built in, so nothing is flagged until they are set here.
 */
export function VitalDefinitionsSettings() {
  const t = useTranslations('settings.vitals');
  const ts = useTranslations('settings');
  const tc = useTranslations('patient.vitals.codes');
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<{ definitions: Definition[]; canEdit: boolean } | null>(null);
  const [editing, setEditing] = useState<VitalSignCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch('/api/v1/vital-sign-definitions'));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PERMISSION_DENIED'
          ? ts('errors.PERMISSION_DENIED')
          : ts('errors.UNKNOWN'),
      );
    }
  }, [ts]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  if (!online && !view) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{ts('offline')}</p>
      </div>
    );
  }
  if (!view) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <Card>
      {dialog}
      <CardHeader>
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="mt-1">{t('subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-success">
            {notice}
          </p>
        )}
        <ul className="divide-y divide-border">
          {view.definitions.map((d) =>
            editing === d.code ? (
              <li key={d.code} className="py-3">
                <DefinitionForm
                  definition={d}
                  onCancel={() => setEditing(null)}
                  onSave={async (body) => {
                    setError(null);
                    try {
                      await guard(() =>
                        apiFetch('/api/v1/vital-sign-definitions', {
                          method: 'POST',
                          body: JSON.stringify(body),
                        }),
                      );
                      setEditing(null);
                      setNotice(t('saved'));
                      await refresh();
                    } catch (err) {
                      setError(
                        err instanceof ApiError && err.code === 'AUTH_STEP_UP_REQUIRED'
                          ? ts('errors.AUTH_STEP_UP_REQUIRED')
                          : ts('errors.VALIDATION_FAILED'),
                      );
                    }
                  }}
                />
              </li>
            ) : (
              <li key={d.code} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-40 font-medium">{tc(d.code)}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {t('plausible', { min: d.plausibleMin, max: d.plausibleMax, unit: d.unit })}
                  {' · '}
                  {d.normalRanges.length > 0
                    ? t('ranges', { count: d.normalRanges.length })
                    : t('noRange')}
                </span>
                {d.configured && <Badge variant="info">{t('custom')}</Badge>}
                {view.canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(d.code)}>
                    {t('edit')}
                  </Button>
                )}
              </li>
            ),
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function DefinitionForm({
  definition,
  onSave,
  onCancel,
}: {
  definition: Definition;
  onSave: (body: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.vitals');
  const [min, setMin] = useState(String(definition.plausibleMin));
  const [max, setMax] = useState(String(definition.plausibleMax));
  const [margin, setMargin] = useState(
    definition.stabilityMargin === null ? '' : String(definition.stabilityMargin),
  );
  const [ranges, setRanges] = useState<RangeDraft[]>(
    definition.normalRanges.map((r) => ({
      sex: r.sex ?? '',
      ageMin: String(r.ageMinYears),
      ageMax: String(r.ageMaxYears),
      low: r.low == null ? '' : String(r.low),
      high: r.high == null ? '' : String(r.high),
    })),
  );
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<RangeDraft>) =>
    setRanges((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave({
          code: definition.code,
          plausibleMin: num(min),
          plausibleMax: num(max),
          stabilityMargin: num(margin),
          normalRanges: ranges.map((r) => ({
            sex: r.sex || null,
            ageMinYears: num(r.ageMin) ?? 0,
            ageMaxYears: num(r.ageMax) ?? 130,
            low: num(r.low),
            high: num(r.high),
          })),
        });
        setBusy(false);
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        <Input
          aria-label={t('min')}
          placeholder={t('min')}
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <Input
          aria-label={t('max')}
          placeholder={t('max')}
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
        <Input
          aria-label={t('margin')}
          placeholder={t('margin')}
          value={margin}
          onChange={(e) => setMargin(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('rangesHint')}</p>
      {ranges.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2">
          <NativeSelect
            aria-label={t('sex')}
            value={r.sex}
            onChange={(e) => set(i, { sex: e.target.value })}
          >
            <option value="">{t('anySex')}</option>
            <option value="M">{t('male')}</option>
            <option value="F">{t('female')}</option>
          </NativeSelect>
          <Input
            aria-label={t('ageMin')}
            placeholder={t('ageMin')}
            value={r.ageMin}
            onChange={(e) => set(i, { ageMin: e.target.value })}
          />
          <Input
            aria-label={t('ageMax')}
            placeholder={t('ageMax')}
            value={r.ageMax}
            onChange={(e) => set(i, { ageMax: e.target.value })}
          />
          <Input
            aria-label={t('low')}
            placeholder={t('low')}
            value={r.low}
            onChange={(e) => set(i, { low: e.target.value })}
          />
          <Input
            aria-label={t('high')}
            placeholder={t('high')}
            value={r.high}
            onChange={(e) => set(i, { high: e.target.value })}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t('removeRange')}
            onClick={() => setRanges((list) => list.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            setRanges((list) => [
              ...list,
              { sex: '', ageMin: '0', ageMax: '130', low: '', high: '' },
            ])
          }
        >
          <Plus />
          {t('addRange')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
