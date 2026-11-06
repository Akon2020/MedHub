'use client';

import {
  ageInMonths,
  childGrowth,
  lmsAt,
  valueAtZ,
  type GrowthIndicator,
  type GrowthResult,
  type GrowthTables,
} from '@medhub/domain';
import { Baby } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/select';
import type { VitalView } from '@/features/patients/vitals-panel';
import type { GrowthLinePoint } from '@/features/charts/growth-chart';

const GrowthChart = dynamic(() => import('@/features/charts/growth-chart'), { ssr: false });

/** The WHO tables cover birth to 19 years. */
export const GROWTH_MAX_AGE_YEARS = 19;

type ChartIndicator = 'weight_for_age' | 'height_for_age' | 'head_for_age' | 'bmi_for_age';
const CHART_CODES: Record<ChartIndicator, { code: string; unit: string }> = {
  weight_for_age: { code: 'weight', unit: 'kg' },
  height_for_age: { code: 'height', unit: 'cm' },
  head_for_age: { code: 'head_circ', unit: 'cm' },
  bmi_for_age: { code: 'bmi', unit: 'kg/m²' },
};

let cached: Promise<GrowthTables> | null = null;
function loadTables(): Promise<GrowthTables> {
  cached ??= import('@medhub/domain/who-growth').then((m) => m.WHO_GROWTH_TABLES);
  return cached;
}

function lines(tables: GrowthTables, sex: 'M' | 'F', indicator: GrowthIndicator, toMonth: number) {
  const out: GrowthLinePoint[] = [];
  for (const row of tables[sex][indicator]) {
    if (row[0] > toMonth) break;
    const lms = lmsAt(tables[sex][indicator], row[0]);
    if (!lms) continue;
    out.push({
      x: row[0],
      m3: valueAtZ(lms, -3),
      m2: valueAtZ(lms, -2),
      m0: valueAtZ(lms, 0),
      p2: valueAtZ(lms, 2),
      p3: valueAtZ(lms, 3),
    });
  }
  return out;
}

/**
 * WHO growth of a child (docs/modules/dpi.md section 3): Z-scores and
 * percentiles of the latest measurements, malnutrition alerts and the curve of
 * the child over the WHO lines. Computed on the device, offline included.
 */
export function GrowthCard({
  sex,
  birthDate,
  vitals,
}: {
  sex: 'M' | 'F';
  birthDate: string;
  vitals: VitalView[];
}) {
  const t = useTranslations('record.growth');
  const [tables, setTables] = useState<GrowthTables | null>(null);
  const [indicator, setIndicator] = useState<ChartIndicator>('weight_for_age');
  const [now] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    void loadTables().then((t) => {
      if (!cancelled) setTables(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = vitals.filter((v) => v.status === 'active');
  const latest = (code: string) =>
    active
      .filter((v) => v.code === code)
      .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0]?.value ?? null;
  if (!tables) return null;

  const growth = childGrowth({
    tables,
    sex,
    birthDate,
    at: now,
    weightKg: latest('weight'),
    heightCm: latest('height'),
    headCm: latest('head_circ'),
    muacMm: latest('muac'),
  });
  const ageNow = ageInMonths(birthDate, now);
  const chart = CHART_CODES[indicator];
  const points =
    indicator === 'bmi_for_age'
      ? active
          .filter((v) => v.code === 'weight')
          .flatMap((w) => {
            const h = active
              .filter((v) => v.code === 'height' && v.measuredAt <= w.measuredAt)
              .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
            return h
              ? [
                  {
                    x: ageInMonths(birthDate, new Date(w.measuredAt)),
                    y: w.value / (h.value / 100) ** 2,
                  },
                ]
              : [];
          })
      : active
          .filter((v) => v.code === chart.code)
          .map((v) => ({ x: ageInMonths(birthDate, new Date(v.measuredAt)), y: v.value }));

  const rows: [string, GrowthResult | null][] = [
    [t('weightForAge'), growth.weightForAge],
    [t('heightForAge'), growth.heightForAge],
    [t(growth.ageMonths < 24 ? 'weightForLength' : 'weightForHeight'), growth.weightForHeight],
    [t('bmiForAge'), growth.bmiForAge],
    [t('headForAge'), growth.headForAge],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Baby className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {growth.alerts.length > 0 && (
          <p className="flex flex-wrap gap-2" role="alert">
            {growth.alerts.map((a) => (
              <Badge
                key={a}
                variant={a.startsWith('severe') || a === 'muac_severe' ? 'danger' : 'warning'}
              >
                {t(`alerts.${a}`)}
              </Badge>
            ))}
          </p>
        )}
        <ul className="grid gap-1">
          {rows
            .filter(([, r]) => r)
            .map(([label, r]) => (
              <li key={label} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums">
                  {t('z', { z: r?.z ?? 0, p: r?.percentile ?? 0 })}
                </span>
              </li>
            ))}
        </ul>
        {rows.every(([, r]) => !r) && <p className="text-muted-foreground">{t('noMeasure')}</p>}
        <NativeSelect
          aria-label={t('curve')}
          value={indicator}
          onChange={(e) => setIndicator(e.target.value as ChartIndicator)}
        >
          {(Object.keys(CHART_CODES) as ChartIndicator[]).map((k) => (
            <option key={k} value={k}>
              {t(`charts.${k}`)}
            </option>
          ))}
        </NativeSelect>
        <GrowthChart
          lines={lines(tables, sex, indicator, Math.max(24, Math.ceil(ageNow) + 6))}
          points={points}
          xLabel={t('months')}
          unit={chart.unit}
        />
        <p className="text-xs text-muted-foreground">{t('source')}</p>
      </CardContent>
    </Card>
  );
}
