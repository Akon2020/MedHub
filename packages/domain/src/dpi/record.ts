import { z } from 'zod';

/**
 * Allergies, medical history and problems (docs/modules/dpi.md section 2):
 * additions from several devices all survive ("union"); nothing is erased, a
 * row is retracted with a reason or, for a problem, resolved.
 */
export const ALLERGY_CATEGORIES = ['drug', 'food', 'environment', 'other'] as const;
export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe', 'life_threatening'] as const;
export const CERTAINTIES = ['suspected', 'confirmed'] as const;
export const HISTORY_CATEGORIES = [
  'medical',
  'surgical',
  'obstetric',
  'family',
  'social',
  'other',
] as const;
export const HISTORY_SOURCES = ['patient', 'other_facility', 'record'] as const;

const optionalDate = z.iso.date().nullish();
const label = z.string().trim().min(2).max(200);
const retractReason = z.string().trim().min(3).max(300);

export const allergyAddPayload = z.object({
  patientId: z.uuid(),
  substance: label,
  atcCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/)
    .nullish(),
  category: z.enum(ALLERGY_CATEGORIES),
  reaction: z.string().trim().max(200).nullish(),
  severity: z.enum(ALLERGY_SEVERITIES),
  certainty: z.enum(CERTAINTIES).default('confirmed'),
  notedAt: z.iso.datetime(),
  status: z.literal('active').default('active'),
});
export type AllergyAddPayload = z.infer<typeof allergyAddPayload>;

/** "No known allergy", dated: distinct from "not asked yet". */
export const allergyNoneKnownPayload = z.object({
  patientId: z.uuid(),
  notedAt: z.iso.datetime(),
  noneKnown: z.literal(true).default(true),
  status: z.literal('active').default('active'),
});

export const historyAddPayload = z.object({
  patientId: z.uuid(),
  category: z.enum(HISTORY_CATEGORIES),
  label,
  icd10: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/)
    .nullish(),
  startDate: optionalDate,
  endDate: optionalDate,
  source: z.enum(HISTORY_SOURCES).default('patient'),
  notedAt: z.iso.datetime(),
  status: z.literal('active').default('active'),
});
export type HistoryAddPayload = z.infer<typeof historyAddPayload>;

export const problemAddPayload = z.object({
  patientId: z.uuid(),
  label,
  icd10: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/)
    .nullish(),
  onsetDate: optionalDate,
  sourceEncounterId: z.uuid().nullish(),
  notedAt: z.iso.datetime(),
  status: z.literal('active').default('active'),
});
export type ProblemAddPayload = z.infer<typeof problemAddPayload>;

export const retractPayload = z.object({ retractReason, retractedAt: z.iso.datetime() });
export const problemResolvePayload = z.object({ resolvedDate: z.iso.date() });

export type AllergyView = {
  id: string;
  substance: string | null;
  category: string;
  severity: string;
  reaction: string | null;
  certainty: string;
  noneKnown: boolean;
  notedAt: string;
  status: string;
};

/**
 * What the banner shows: active allergies, most severe first; "no known
 * allergy" only when it is the latest statement and no allergy is active.
 */
export function allergyStatus(rows: readonly AllergyView[]): {
  allergies: AllergyView[];
  noneKnownAt: string | null;
} {
  const active = rows.filter((r) => r.status === 'active');
  const rank = (s: string) => ALLERGY_SEVERITIES.indexOf(s as (typeof ALLERGY_SEVERITIES)[number]);
  const allergies = active
    .filter((r) => !r.noneKnown)
    .sort((a, b) => rank(b.severity) - rank(a.severity) || b.notedAt.localeCompare(a.notedAt));
  const noneKnown = active
    .filter((r) => r.noneKnown)
    .sort((a, b) => b.notedAt.localeCompare(a.notedAt))[0];
  return { allergies, noneKnownAt: allergies.length === 0 ? (noneKnown?.notedAt ?? null) : null };
}

/** Identical additions made on two devices are grouped for display, never merged in storage. */
export function groupDuplicates<T extends { status: string }>(
  rows: readonly T[],
  key: (row: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (row.status === 'active' && seen.has(k)) continue;
    if (row.status === 'active') seen.add(k);
    out.push(row);
  }
  return out;
}
