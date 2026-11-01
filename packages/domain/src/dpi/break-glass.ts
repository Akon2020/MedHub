import type { PatientSensitivity } from '@medhub/shared';
import { z } from 'zod';
import { sensitivityAllowed } from '../core/access';

/**
 * Emergency access ("break glass", docs/03-multitenant-securite.md section 4):
 * a record beyond the user's usual rights opens after a mandatory reason, for
 * a limited time, offline included for a record already on the device. Every
 * opening is reviewed afterwards. Neither licence nor payment ever blocks it.
 */
export const BREAK_GLASS_REASONS = [
  'life_threatening',
  'unconscious_patient',
  'continuity_of_care',
  'other',
] as const;
export type BreakGlassReason = (typeof BREAK_GLASS_REASONS)[number];

export const BREAK_GLASS_MAX_HOURS = 24;

export const breakGlassPayload = z
  .object({
    patientId: z.uuid(),
    reasonCode: z.enum(BREAK_GLASS_REASONS),
    reasonText: z.string().trim().min(5).max(500),
    startedAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .refine(
    (p) => {
      const span = Date.parse(p.endsAt) - Date.parse(p.startedAt);
      return span > 0 && span <= BREAK_GLASS_MAX_HOURS * 3_600_000;
    },
    { message: 'DPI_BREAK_GLASS_DURATION', path: ['endsAt'] },
  );
export type BreakGlassPayload = z.infer<typeof breakGlassPayload>;

export const BREAK_GLASS_OUTCOMES = ['justified', 'to_investigate'] as const;
export const breakGlassReviewInput = z.object({
  breakGlassId: z.uuid(),
  outcome: z.enum(BREAK_GLASS_OUTCOMES),
  comment: z.string().trim().max(500).nullish(),
});

export type BreakGlassGrant = {
  patientId: string;
  userId: string;
  startedAt: string;
  endsAt: string;
};

/** An emergency access of this user to this patient still running at `now`. */
export function activeBreakGlass(
  grants: readonly BreakGlassGrant[],
  userId: string,
  patientId: string,
  now: Date,
): BreakGlassGrant | null {
  const t = now.getTime();
  return (
    grants
      .filter(
        (g) =>
          g.userId === userId &&
          g.patientId === patientId &&
          Date.parse(g.startedAt) <= t + 60_000 &&
          Date.parse(g.endsAt) > t,
      )
      .sort((a, b) => b.endsAt.localeCompare(a.endsAt))[0] ?? null
  );
}

/** Whether the record opens as usual, needs an emergency access, or is open through one. */
export function recordAccess(
  sensitivity: unknown,
  max: PatientSensitivity,
  grant: BreakGlassGrant | null,
): 'open' | 'locked' | 'emergency' {
  if (sensitivityAllowed(sensitivity, max)) return 'open';
  return grant ? 'emergency' : 'locked';
}
