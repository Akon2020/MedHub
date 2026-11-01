import { z } from 'zod';

/** Demographic values a merge may take from either record (birth date with its estimate flag). */
export const MERGE_FIELDS = [
  'familyName',
  'middleName',
  'givenName',
  'sex',
  'birthDate',
  'phone',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export type Demographics = {
  familyName: string;
  middleName: string | null;
  givenName: string | null;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
};
export type DemographicsPatch = Partial<Demographics>;

export const patientMergeSchema = z
  .object({
    survivorId: z.uuid(),
    mergedId: z.uuid(),
    keep: z.partialRecord(z.enum(MERGE_FIELDS), z.enum(['survivor', 'merged'])).default({}),
    reason: z.string().trim().min(3).max(300),
    candidateId: z.uuid().nullish(),
  })
  .refine((m) => m.survivorId !== m.mergedId, { message: 'PAT_MERGE_SAME', path: ['mergedId'] });
export type PatientMergeInput = z.infer<typeof patientMergeSchema>;

export const patientUnmergeSchema = z.object({
  mergeId: z.uuid(),
  reason: z.string().trim().min(3).max(300),
});

function fieldsOf(field: MergeField): (keyof Demographics)[] {
  return field === 'birthDate' ? ['birthDate', 'birthDateEstimated'] : [field];
}

/** Values of the merged record the user chose to keep on the survivor. */
export function mergePatch(
  survivor: Demographics,
  merged: Demographics,
  keep: Partial<Record<MergeField, 'survivor' | 'merged'>>,
): DemographicsPatch {
  const patch: Record<string, unknown> = {};
  for (const field of MERGE_FIELDS) {
    if (keep[field] !== 'merged') continue;
    for (const key of fieldsOf(field)) {
      if (survivor[key] !== merged[key]) patch[key] = merged[key];
    }
  }
  return patch as DemographicsPatch;
}

/**
 * Undoing a merge restores the survivor's previous values, except for a field
 * changed again since the merge: the newer value is kept and reported.
 */
export function unmergePatch(
  before: Demographics,
  applied: DemographicsPatch,
  current: Demographics,
): { patch: DemographicsPatch; kept: (keyof Demographics)[] } {
  const patch: Record<string, unknown> = {};
  const kept: (keyof Demographics)[] = [];
  for (const key of Object.keys(applied) as (keyof Demographics)[]) {
    if (current[key] === applied[key]) patch[key] = before[key];
    else kept.push(key);
  }
  return { patch: patch as DemographicsPatch, kept: kept.sort() };
}

/**
 * The survivor and every record merged into it, directly or through an
 * earlier merge: a timeline shows all of them, no clinical row is rewritten.
 */
export function mergeClosure(
  rootId: string,
  records: readonly { id: string; mergedIntoId: string | null }[],
): string[] {
  const children = new Map<string, string[]>();
  for (const r of records) {
    if (!r.mergedIntoId) continue;
    children.set(r.mergedIntoId, [...(children.get(r.mergedIntoId) ?? []), r.id]);
  }
  const out = [rootId];
  for (let i = 0; i < out.length; i += 1) {
    for (const child of children.get(out[i] ?? '') ?? []) {
      if (!out.includes(child)) out.push(child);
    }
  }
  return out;
}

/** Follows merges forward: the record a page should show for an old identifier. */
export function mergeTarget(
  id: string,
  mergedIntoOf: (id: string) => string | null | undefined,
): string {
  let current = id;
  const seen = new Set<string>([current]);
  for (let next = mergedIntoOf(current); next && !seen.has(next); next = mergedIntoOf(current)) {
    current = next;
    seen.add(current);
  }
  return current;
}
