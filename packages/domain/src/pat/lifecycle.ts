import { z } from 'zod';

/**
 * Provisional records (docs/modules/pat.md, capability 5): an unidentified
 * emergency or a newborn registered before its own identity is known.
 */
export const PROVISIONAL_KINDS = ['unknown', 'newborn'] as const;
export type ProvisionalKind = (typeof PROVISIONAL_KINDS)[number];

/**
 * Death recorded on the record (capability 10). A null date withdraws a
 * declaration made by mistake, and then a reason is mandatory.
 */
export const patientDeathPayload = z
  .object({
    deceasedAt: z.iso.datetime().nullable(),
    correctionReason: z.string().trim().min(3).max(300).nullish(),
  })
  .refine((p) => p.deceasedAt !== null || Boolean(p.correctionReason), 'PAT_DEATH_REASON_REQUIRED');
export type PatientDeathPayload = z.infer<typeof patientDeathPayload>;

/**
 * After death the record is read-only for new clinical acts; an act that took
 * place before the time of death can still be recorded late.
 */
export function blockedByDeath(deceasedAt: unknown, actAt: string): boolean {
  if (typeof deceasedAt !== 'string' || deceasedAt === '') return false;
  const death = Date.parse(deceasedAt);
  const act = Date.parse(actAt);
  return Number.isFinite(death) && Number.isFinite(act) && act > death;
}

export function isProvisionalRecord(data: Record<string, unknown>): boolean {
  return data.isProvisional === true;
}
