import { VITAL_SIGN_CODES, type VitalSignCode } from '@medhub/shared';
import { z } from 'zod';

export const vitalSignRecordPayload = z.object({
  patientId: z.uuid(),
  encounterId: z.uuid().nullish(),
  code: z.enum(VITAL_SIGN_CODES),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(16),
  measuredAt: z.iso.datetime(),
  supersedesId: z.uuid().nullish(),
  plausibilityOverrideReason: z.string().trim().min(3).max(500).nullish(),
});
export type VitalSignRecordPayload = z.infer<typeof vitalSignRecordPayload>;

export type VitalSignDefinition = {
  code: VitalSignCode;
  unit: string;
  plausibleMin: number;
  plausibleMax: number;
};

/**
 * Default physical plausibility bounds used until a structure publishes its own
 * `vital_sign_definition` rows. They only catch typing errors (a 200 kg infant),
 * they are not clinical normal ranges.
 */
export const DEFAULT_VITAL_SIGN_DEFINITIONS: readonly VitalSignDefinition[] = [
  { code: 'temp', unit: '°C', plausibleMin: 25, plausibleMax: 45 },
  { code: 'pulse', unit: '/min', plausibleMin: 20, plausibleMax: 260 },
  { code: 'sbp', unit: 'mmHg', plausibleMin: 40, plausibleMax: 300 },
  { code: 'dbp', unit: 'mmHg', plausibleMin: 20, plausibleMax: 200 },
  { code: 'rr', unit: '/min', plausibleMin: 4, plausibleMax: 120 },
  { code: 'spo2', unit: '%', plausibleMin: 40, plausibleMax: 100 },
  { code: 'weight', unit: 'kg', plausibleMin: 0.3, plausibleMax: 350 },
  { code: 'height', unit: 'cm', plausibleMin: 20, plausibleMax: 250 },
  { code: 'head_circ', unit: 'cm', plausibleMin: 20, plausibleMax: 70 },
  { code: 'muac', unit: 'mm', plausibleMin: 50, plausibleMax: 500 },
  { code: 'glucose', unit: 'mg/dL', plausibleMin: 10, plausibleMax: 1000 },
  { code: 'pain', unit: '/10', plausibleMin: 0, plausibleMax: 10 },
  { code: 'diuresis', unit: 'mL', plausibleMin: 0, plausibleMax: 10000 },
];

export type PlausibilityResult = { ok: true } | { ok: false; reason: 'DPI_VITAL_IMPLAUSIBLE' };

export function checkVitalPlausibility(
  payload: Pick<VitalSignRecordPayload, 'code' | 'value' | 'plausibilityOverrideReason'>,
  definitions: readonly VitalSignDefinition[] = DEFAULT_VITAL_SIGN_DEFINITIONS,
): PlausibilityResult {
  const def = definitions.find((d) => d.code === payload.code);
  if (!def) return { ok: true };
  const inRange = payload.value >= def.plausibleMin && payload.value <= def.plausibleMax;
  if (inRange || payload.plausibilityOverrideReason) return { ok: true };
  return { ok: false, reason: 'DPI_VITAL_IMPLAUSIBLE' };
}
