import { VITAL_SIGN_CODES } from '@medhub/shared';
import { z } from 'zod';

/** Body mass index (kg/m²), one decimal. */
export function bodyMassIndex(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/** Body surface area, Mosteller formula (m²), two decimals. */
export function bodySurfaceArea(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) return null;
  return Math.round(Math.sqrt((heightCm * weightKg) / 3600) * 100) / 100;
}

/** Exact age for display: days under a month, months under two years, then years. */
export function exactAge(
  birthDate: string,
  at: Date,
): { unit: 'days' | 'months' | 'years'; value: number } {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const days = Math.floor((at.getTime() - birth.getTime()) / 86_400_000);
  let months =
    (at.getUTCFullYear() - birth.getUTCFullYear()) * 12 + at.getUTCMonth() - birth.getUTCMonth();
  if (at.getUTCDate() < birth.getUTCDate()) months -= 1;
  if (days < 31) return { unit: 'days', value: Math.max(0, days) };
  if (months < 24) return { unit: 'months', value: months };
  return { unit: 'years', value: Math.floor(months / 12) };
}

export type Trend = 'up' | 'down' | 'stable';

/**
 * Direction compared with the previous measurement. A change within the
 * stability margin (2 % of the previous value unless the structure sets one)
 * reads as stable.
 */
export function trendOf(current: number, previous: number | null, margin?: number): Trend | null {
  if (previous === null) return null;
  const limit = margin ?? Math.abs(previous) * 0.02;
  if (current - previous > limit) return 'up';
  if (previous - current > limit) return 'down';
  return 'stable';
}

/**
 * NEWS2 (Royal College of Physicians, National Early Warning Score 2, 2017),
 * SpO2 scale 1, for adults. Consciousness and supplemental oxygen are not
 * recorded yet: when they are missing the score is marked partial.
 */
export type News2Input = {
  rr?: number | null;
  spo2?: number | null;
  sbp?: number | null;
  pulse?: number | null;
  temp?: number | null;
  onOxygen?: boolean | null;
  /** Alert (A) or new confusion, voice, pain, unresponsive (CVPU). */
  consciousness?: 'A' | 'CVPU' | null;
};

export type News2Result = {
  score: number;
  /** One parameter scoring 3 calls for an urgent review even with a low total. */
  redScore: boolean;
  risk: 'low' | 'low_medium' | 'medium' | 'high';
  partial: boolean;
};

function band(value: number, bands: readonly [number, number][]): number {
  for (const [limit, points] of bands) if (value <= limit) return points;
  return bands[bands.length - 1]?.[1] ?? 0;
}

export function news2(input: News2Input): News2Result | null {
  const parts: number[] = [];
  if (input.rr != null)
    parts.push(
      band(input.rr, [
        [8, 3],
        [11, 1],
        [20, 0],
        [24, 2],
        [Infinity, 3],
      ]),
    );
  if (input.spo2 != null)
    parts.push(
      band(input.spo2, [
        [91, 3],
        [93, 2],
        [95, 1],
        [Infinity, 0],
      ]),
    );
  if (input.onOxygen != null) parts.push(input.onOxygen ? 2 : 0);
  if (input.sbp != null)
    parts.push(
      band(input.sbp, [
        [90, 3],
        [100, 2],
        [110, 1],
        [219, 0],
        [Infinity, 3],
      ]),
    );
  if (input.pulse != null)
    parts.push(
      band(input.pulse, [
        [40, 3],
        [50, 1],
        [90, 0],
        [110, 1],
        [130, 2],
        [Infinity, 3],
      ]),
    );
  if (input.consciousness != null) parts.push(input.consciousness === 'A' ? 0 : 3);
  if (input.temp != null)
    parts.push(
      band(input.temp, [
        [35, 3],
        [36, 1],
        [38, 0],
        [39, 1],
        [Infinity, 2],
      ]),
    );
  if (parts.length === 0) return null;
  const score = parts.reduce((a, b) => a + b, 0);
  const redScore = parts.includes(3);
  const risk = score >= 7 ? 'high' : score >= 5 ? 'medium' : redScore ? 'low_medium' : 'low';
  const partial = [
    input.rr,
    input.spo2,
    input.onOxygen,
    input.sbp,
    input.pulse,
    input.consciousness,
    input.temp,
  ].some((v) => v == null);
  return { score, redScore, risk, partial };
}

/**
 * Normal ranges configured by the structure (docs/modules/dpi.md section 3).
 * No clinical range is built in: without one, nothing is flagged out of range.
 */
export const normalRangeSchema = z
  .object({
    sex: z.enum(['M', 'F']).nullish(),
    ageMinYears: z.number().min(0).max(130).default(0),
    ageMaxYears: z.number().min(0).max(130).default(130),
    low: z.number().nullish(),
    high: z.number().nullish(),
  })
  .refine((r) => r.ageMaxYears >= r.ageMinYears, {
    message: 'DPI_RANGE_AGES',
    path: ['ageMaxYears'],
  })
  .refine((r) => r.low == null || r.high == null || r.high > r.low, {
    message: 'DPI_RANGE_BOUNDS',
    path: ['high'],
  });
export type NormalRange = z.infer<typeof normalRangeSchema>;

export const vitalDefinitionInput = z
  .object({
    code: z.enum(VITAL_SIGN_CODES),
    plausibleMin: z.number(),
    plausibleMax: z.number(),
    stabilityMargin: z.number().min(0).nullish(),
    normalRanges: z.array(normalRangeSchema).max(20).default([]),
  })
  .refine((d) => d.plausibleMax > d.plausibleMin, {
    message: 'DPI_RANGE_BOUNDS',
    path: ['plausibleMax'],
  });
export type VitalDefinitionInput = z.infer<typeof vitalDefinitionInput>;

/** Range that applies to a patient: the most specific match (sex given wins). */
export function normalRangeFor(
  ranges: readonly NormalRange[],
  sex: string | null,
  ageYears: number | null,
): NormalRange | null {
  const matching = ranges.filter(
    (r) =>
      (!r.sex || r.sex === sex) &&
      (ageYears === null || (ageYears >= r.ageMinYears && ageYears <= r.ageMaxYears)),
  );
  return matching.sort((a, b) => Number(Boolean(b.sex)) - Number(Boolean(a.sex)))[0] ?? null;
}

export function outOfRange(value: number, range: NormalRange | null): 'low' | 'high' | null {
  if (!range) return null;
  if (range.low != null && value < range.low) return 'low';
  if (range.high != null && value > range.high) return 'high';
  return null;
}
