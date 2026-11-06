import { z } from 'zod';

/**
 * Chronic care programmes (docs/modules/dpi.md section 6): a patient enrolled
 * in a programme is expected back within its follow-up interval; beyond the
 * interval plus the grace period he is "lost to follow-up".
 */
export const DEFAULT_GRACE_DAYS = 14;

export const programInput = z.object({
  id: z.uuid().nullish(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z0-9_]{2,16}$/)),
  name: z.string().trim().min(2).max(80),
  followUpIntervalDays: z.int().min(1).max(365),
  graceDays: z.int().min(0).max(180).default(DEFAULT_GRACE_DAYS),
  isActive: z.boolean().default(true),
});
export type ProgramInput = z.infer<typeof programInput>;

export const programEnrollPayload = z.object({
  patientId: z.uuid(),
  programId: z.uuid(),
  enrolledAt: z.iso.datetime(),
  status: z.literal('active').default('active'),
});
export const programDischargePayload = z.object({
  dischargedAt: z.iso.datetime(),
  dischargeReason: z.string().trim().min(3).max(300),
});

export type FollowUp = { dueAt: string; lost: boolean; daysLate: number };

/**
 * Next expected contact and whether the patient is lost to follow-up. Without
 * any contact since enrolment, the enrolment date counts as the last contact.
 */
export function followUpStatus(input: {
  enrolledAt: string;
  lastContact: string | null;
  intervalDays: number;
  graceDays: number;
  now: Date;
}): FollowUp {
  const last = Math.max(
    Date.parse(input.enrolledAt),
    input.lastContact ? Date.parse(input.lastContact) : 0,
  );
  const due = last + input.intervalDays * 86_400_000;
  const late = Math.floor((input.now.getTime() - due) / 86_400_000);
  return {
    dueAt: new Date(due).toISOString(),
    lost: late > input.graceDays,
    daysLate: Math.max(0, late),
  };
}
