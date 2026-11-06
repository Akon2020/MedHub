/**
 * WHO growth indicators (docs/modules/dpi.md section 3): Z-scores from the LMS
 * parameters of the WHO Child Growth Standards (0 to 5 years) and Growth
 * Reference (5 to 19 years). The tables themselves are loaded on demand from
 * `@medhub/domain/who-growth`; this module only computes.
 */
export type LmsRow = readonly [x: number, L: number, M: number, S: number];

export const GROWTH_INDICATORS = [
  'weight_for_age',
  'height_for_age',
  'bmi_for_age',
  'head_for_age',
  'weight_for_length',
  'weight_for_height',
] as const;
export type GrowthIndicator = (typeof GROWTH_INDICATORS)[number];
export type GrowthTables = Record<'M' | 'F', Record<GrowthIndicator, readonly LmsRow[]>>;

/** WHO convention for converting an age in days to months. */
export const DAYS_PER_MONTH = 30.4375;

/** Indicators where WHO restricts the LMS extrapolation beyond ±3 SD (weight-based ones). */
const RESTRICTED: ReadonlySet<GrowthIndicator> = new Set([
  'weight_for_age',
  'bmi_for_age',
  'weight_for_length',
  'weight_for_height',
]);

export type Lms = { L: number; M: number; S: number };

/** LMS at `x`, linearly interpolated between table rows; null outside the table. */
export function lmsAt(rows: readonly LmsRow[], x: number): Lms | null {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last || x < first[0] || x > last[0]) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid]?.[0] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const a = rows[lo] as LmsRow;
  const b = rows[hi] as LmsRow;
  const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
  return {
    L: a[1] + (b[1] - a[1]) * t,
    M: a[2] + (b[2] - a[2]) * t,
    S: a[3] + (b[3] - a[3]) * t,
  };
}

/** Measurement at a given Z-score: M (1 + L S z)^(1/L). */
export function valueAtZ({ L, M, S }: Lms, z: number): number {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/**
 * Z-score of a measurement. For weight-based indicators beyond ±3, WHO
 * replaces the LMS curve by the distance between the 2 and 3 SD lines.
 */
export function zScore(y: number, lms: Lms, restricted: boolean): number {
  const { L, M, S } = lms;
  const z = L === 0 ? Math.log(y / M) / S : (Math.pow(y / M, L) - 1) / (L * S);
  if (!restricted || Math.abs(z) <= 3) return z;
  if (z > 3) {
    const sd3 = valueAtZ(lms, 3);
    return 3 + (y - sd3) / (sd3 - valueAtZ(lms, 2));
  }
  const sd3 = valueAtZ(lms, -3);
  return -3 - (sd3 - y) / (valueAtZ(lms, -2) - sd3);
}

/** Standard normal cumulative probability (Abramowitz and Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export type GrowthResult = { z: number; percentile: number };

export function growthZ(
  tables: GrowthTables,
  sex: 'M' | 'F',
  indicator: GrowthIndicator,
  x: number,
  y: number,
): GrowthResult | null {
  const lms = lmsAt(tables[sex][indicator], x);
  if (!lms || y <= 0) return null;
  const z = Math.round(zScore(y, lms, RESTRICTED.has(indicator)) * 100) / 100;
  return { z, percentile: Math.round(normalCdf(z) * 1000) / 10 };
}

export type GrowthAlert =
  | 'severe_wasting'
  | 'wasting'
  | 'severe_stunting'
  | 'stunting'
  | 'severe_underweight'
  | 'underweight'
  | 'muac_severe'
  | 'muac_moderate';

/** MUAC cut-offs for children of 6 to 59 months (docs/modules/dpi.md section 3). */
export const MUAC_SEVERE_MM = 115;
export const MUAC_MODERATE_MM = 125;

export type ChildGrowth = {
  ageMonths: number;
  weightForAge: GrowthResult | null;
  heightForAge: GrowthResult | null;
  bmiForAge: GrowthResult | null;
  headForAge: GrowthResult | null;
  /** Weight-for-length under 24 months, weight-for-height from 24 months. */
  weightForHeight: GrowthResult | null;
  alerts: GrowthAlert[];
};

export function ageInMonths(birthDate: string, at: Date): number {
  const days = (at.getTime() - Date.parse(`${birthDate}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, days / DAYS_PER_MONTH);
}

export function childGrowth(input: {
  tables: GrowthTables;
  sex: 'M' | 'F';
  birthDate: string;
  at: Date;
  weightKg?: number | null;
  heightCm?: number | null;
  headCm?: number | null;
  muacMm?: number | null;
}): ChildGrowth {
  const { tables, sex } = input;
  const age = ageInMonths(input.birthDate, input.at);
  const w = input.weightKg ?? null;
  const h = input.heightCm ?? null;
  const at = (indicator: GrowthIndicator, x: number, y: number | null) =>
    y === null ? null : growthZ(tables, sex, indicator, x, y);
  const result: ChildGrowth = {
    ageMonths: Math.round(age * 10) / 10,
    weightForAge: at('weight_for_age', age, w),
    heightForAge: at('height_for_age', age, h),
    bmiForAge: w !== null && h !== null ? at('bmi_for_age', age, w / (h / 100) ** 2) : null,
    headForAge: at('head_for_age', age, input.headCm ?? null),
    weightForHeight:
      w !== null && h !== null
        ? at(age < 24 ? 'weight_for_length' : 'weight_for_height', h, w)
        : null,
    alerts: [],
  };
  const alerts = result.alerts;
  const z = (r: GrowthResult | null) => r?.z ?? 0;
  if (result.weightForHeight && z(result.weightForHeight) < -3) alerts.push('severe_wasting');
  else if (result.weightForHeight && z(result.weightForHeight) < -2) alerts.push('wasting');
  if (result.heightForAge && z(result.heightForAge) < -3) alerts.push('severe_stunting');
  else if (result.heightForAge && z(result.heightForAge) < -2) alerts.push('stunting');
  if (result.weightForAge && z(result.weightForAge) < -3) alerts.push('severe_underweight');
  else if (result.weightForAge && z(result.weightForAge) < -2) alerts.push('underweight');
  const muac = input.muacMm ?? null;
  if (muac !== null && age >= 6 && age < 60) {
    if (muac < MUAC_SEVERE_MM) alerts.push('muac_severe');
    else if (muac < MUAC_MODERATE_MM) alerts.push('muac_moderate');
  }
  return result;
}
