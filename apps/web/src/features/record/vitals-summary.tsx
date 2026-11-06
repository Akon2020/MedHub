'use client';

import {
  ageInYears,
  bodyMassIndex,
  bodySurfaceArea,
  news2,
  normalRangeFor,
  outOfRange,
  trendOf,
  type Trend,
} from '@medhub/domain';
import { VITAL_SIGN_CODES, type VitalSignCode } from '@medhub/shared';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Gauge } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { VitalView } from '@/features/patients/vitals-panel';

const TrendChart = dynamic(() => import('@/features/charts/trend-chart'), { ssr: false });

/** NEWS2 is defined for adults (16 years and over). */
const NEWS2_MIN_AGE = 16;
/** Measurements older than this are not combined into a score. */
const NEWS2_WINDOW_MS = 24 * 3_600_000;

const TREND_ICON: Record<Trend, typeof ArrowRight> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  stable: ArrowRight,
};

/**
 * Latest value of each vital sign with its trend and normal range, derived
 * values (BMI, body surface area, NEWS2) and the curve of any vital sign over
 * the whole record. Everything is computed on the device.
 */
export function VitalsSummary({
  vitals,
  sex,
  birthDate,
}: {
  vitals: VitalView[];
  sex: string;
  birthDate: string | null;
}) {
  const t = useTranslations('record.vitals');
  const tc = useTranslations('patient.vitals.codes');
  const format = useFormatter();
  const { catalogs } = useRuntime();
  const definitions = catalogs?.snapshot.vitalDefinitions ?? [];
  const [chartCode, setChartCode] = useState<VitalSignCode>('temp');
  const [now] = useState(() => Date.now());
  const age = birthDate ? ageInYears(birthDate, new Date(now)) : null;

  const active = vitals.filter((v) => v.status === 'active');
  const byCode = new Map<string, VitalView[]>();
  for (const v of [...active].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))) {
    byCode.set(v.code, [...(byCode.get(v.code) ?? []), v]);
  }
  const latest = (code: string) => byCode.get(code)?.[0] ?? null;
  const recent = (code: string) => {
    const v = latest(code);
    return v && now - Date.parse(v.measuredAt) <= NEWS2_WINDOW_MS ? v.value : null;
  };

  const weight = latest('weight')?.value ?? null;
  const height = latest('height')?.value ?? null;
  const bmi = weight && height ? bodyMassIndex(weight, height) : null;
  const bsa = weight && height ? bodySurfaceArea(weight, height) : null;
  const score =
    age !== null && age >= NEWS2_MIN_AGE
      ? news2({
          rr: recent('rr'),
          spo2: recent('spo2'),
          sbp: recent('sbp'),
          pulse: recent('pulse'),
          temp: recent('temp'),
        })
      : null;

  const codes = VITAL_SIGN_CODES.filter((c) => byCode.has(c));
  const shown = codes.includes(chartCode) ? chartCode : (codes[0] ?? chartCode);
  const chart = (byCode.get(shown) ?? [])
    .slice()
    .reverse()
    .map((v) => ({
      label: format.dateTime(new Date(v.measuredAt), {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      value: v.value,
    }));
  const chartUnit = definitions.find((d) => d.code === shown)?.unit;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {codes.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {codes.map((code) => {
              const [last, previous] = byCode.get(code) ?? [];
              if (!last) return null;
              const def = definitions.find((d) => d.code === code);
              const trend = trendOf(
                last.value,
                previous?.value ?? null,
                def?.stabilityMargin ?? undefined,
              );
              const flag = outOfRange(
                last.value,
                normalRangeFor(def?.normalRanges ?? [], sex, age),
              );
              const Icon = trend ? TREND_ICON[trend] : null;
              return (
                <li
                  key={code}
                  className={cn(
                    'rounded-lg px-3 py-2 ring-1 ring-border',
                    flag && 'bg-warning-soft ring-warning/40',
                  )}
                >
                  <span className="block text-xs text-muted-foreground">{tc(code)}</span>
                  <span className="flex items-center gap-1 font-semibold tabular-nums">
                    {last.value} {last.unit}
                    {Icon && (
                      <Icon
                        className="size-3.5 text-muted-foreground"
                        aria-label={t(`trend.${trend}`)}
                      />
                    )}
                  </span>
                  {flag && <span className="text-xs text-warning">{t(`flag.${flag}`)}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {(bmi !== null || score) && (
          <div className="flex flex-wrap gap-2">
            {bmi !== null && <Badge variant="info">{t('bmi', { value: bmi })}</Badge>}
            {bsa !== null && <Badge variant="info">{t('bsa', { value: bsa })}</Badge>}
            {score && (
              <Badge
                variant={
                  score.risk === 'high' || score.risk === 'medium'
                    ? 'danger'
                    : score.redScore
                      ? 'warning'
                      : 'muted'
                }
              >
                {t('news2', { score: score.score })} · {t(`risk.${score.risk}`)}
                {score.partial ? ` · ${t('partial')}` : ''}
              </Badge>
            )}
          </div>
        )}
        {codes.length > 0 && (
          <div className="grid gap-2">
            <NativeSelect
              aria-label={t('curve')}
              value={shown}
              onChange={(e) => setChartCode(e.target.value as VitalSignCode)}
            >
              {codes.map((c) => (
                <option key={c} value={c}>
                  {tc(c)}
                </option>
              ))}
            </NativeSelect>
            {chart.length >= 2 ? (
              <TrendChart data={chart} unit={chartUnit} />
            ) : (
              <p className="py-6 text-center text-muted-foreground">{t('notEnough')}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
