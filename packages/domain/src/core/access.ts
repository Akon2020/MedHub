import { PATIENT_SENSITIVITIES, type PatientSensitivity } from '@medhub/shared';

/**
 * Attribute-based rules of docs/05-roles-permissions.md section 1, evaluated
 * identically wherever access is decided.
 */
export const SENSITIVITY_RANK: Readonly<Record<PatientSensitivity, number>> = {
  normal: 0,
  staff: 1,
  vip: 2,
  restricted: 3,
};

export function isSensitivity(value: unknown): value is PatientSensitivity {
  return typeof value === 'string' && (PATIENT_SENSITIVITIES as readonly string[]).includes(value);
}

/** A record with an unknown level is treated as the most protected one. */
export function sensitivityAllowed(level: unknown, max: PatientSensitivity): boolean {
  const rank = isSensitivity(level) ? SENSITIVITY_RANK[level] : SENSITIVITY_RANK.restricted;
  return rank <= SENSITIVITY_RANK[max];
}

/** Levels a user may open, for a database filter. */
export function allowedSensitivities(max: PatientSensitivity): PatientSensitivity[] {
  return PATIENT_SENSITIVITIES.filter((level) => SENSITIVITY_RANK[level] <= SENSITIVITY_RANK[max]);
}

export type RoleAccessGrant = { key: string; conditions: Record<string, unknown> };

/**
 * Level a role gives access to: the `sensitivity_max` condition of its
 * patient:read grant when set; otherwise every level for a role that may mark
 * records as sensitive (it must see what it protects), and normal records only
 * for the others. Null when the role does not read patients at all.
 */
export function roleSensitivityMax(grants: readonly RoleAccessGrant[]): PatientSensitivity | null {
  const read = grants.find((g) => g.key === 'patient:read');
  if (!read) return null;
  const explicit = read.conditions.sensitivity_max;
  if (isSensitivity(explicit)) return explicit;
  return grants.some((g) => g.key === 'patient:mark_sensitive') ? 'restricted' : 'normal';
}

/** The most permissive level among the user's roles. */
export function userSensitivityMax(
  roles: readonly (readonly RoleAccessGrant[])[],
): PatientSensitivity {
  let best: PatientSensitivity = 'normal';
  for (const grants of roles) {
    const level = roleSensitivityMax(grants);
    if (level && SENSITIVITY_RANK[level] > SENSITIVITY_RANK[best]) best = level;
  }
  return best;
}
