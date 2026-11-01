import { z } from 'zod';

/**
 * Which patients a device receives (docs/02-offline-sync.md section 8). "all"
 * is the full preload suited to small structures; "scoped" keeps the patients
 * created on the device, the user's favourites, the patients opened from a
 * server search, those with recent activity (changes, measurements, visits)
 * and those with an appointment in the coming week. Admissions and chronic
 * programmes join the scoped rule with their modules.
 */
export const SYNC_SCOPE_MODES = ['all', 'scoped'] as const;
export type SyncScopeMode = (typeof SYNC_SCOPE_MODES)[number];

export const patientScopeRuleSchema = z.object({
  mode: z.enum(SYNC_SCOPE_MODES),
  recentDays: z.int().min(1).max(365).default(30),
});
export type PatientScopeRule = z.infer<typeof patientScopeRuleSchema>;

/** Until a structure says otherwise: the pilot hospital is far below 5 000 patients. */
export const DEFAULT_PATIENT_SCOPE: PatientScopeRule = { mode: 'all', recentDays: 30 };

export const syncScopeRuleInput = z.object({
  roleId: z.uuid().nullable(),
  rule: patientScopeRuleSchema.nullable(),
});
export type SyncScopeRuleInput = z.infer<typeof syncScopeRuleInput>;

/**
 * Rules of the user's roles first, the most generous one winning; otherwise
 * the structure's default rule; otherwise the built-in default.
 */
export function effectivePatientScope(
  rules: readonly { roleId: string | null; rule: unknown }[],
  userRoleIds: readonly string[],
): PatientScopeRule {
  const parsed = rules.flatMap((r) => {
    const rule = patientScopeRuleSchema.safeParse(r.rule);
    return rule.success ? [{ roleId: r.roleId, rule: rule.data }] : [];
  });
  const own = parsed.filter((r) => r.roleId !== null && userRoleIds.includes(r.roleId));
  if (own.length > 0) {
    if (own.some((r) => r.rule.mode === 'all')) return { mode: 'all', recentDays: 30 };
    return { mode: 'scoped', recentDays: Math.max(...own.map((r) => r.rule.recentDays)) };
  }
  return parsed.find((r) => r.roleId === null)?.rule ?? DEFAULT_PATIENT_SCOPE;
}

export type PatientScopeFacts = {
  createdHere: boolean;
  favorite: boolean;
  pinned: boolean;
  /** Latest change, measurement or visit of the patient. */
  lastActivity: Date | null;
  /** An appointment from yesterday to the next seven days (docs/02 section 8). */
  upcomingAppointment?: boolean;
};

/** Window of appointments that bring a patient to the devices. */
export const APPOINTMENT_SCOPE_DAYS = 7;

export function inPatientScope(
  facts: PatientScopeFacts,
  rule: PatientScopeRule,
  now: Date,
): boolean {
  if (rule.mode === 'all') return true;
  if (facts.createdHere || facts.favorite || facts.pinned || facts.upcomingAppointment) return true;
  if (!facts.lastActivity) return false;
  return now.getTime() - facts.lastActivity.getTime() <= rule.recentDays * 86_400_000;
}
