import {
  FREQUENCIES,
  type AlertSeverity,
  type DrugInfo,
  type Frequency,
  type InteractionRule,
} from './prescription';

/**
 * Prescription safety checks (docs/modules/dpi.md section 5): deterministic,
 * run on the workstation before signing, offline included. Each alert names
 * the line it concerns; a blocking one needs the override permission and a
 * justification.
 */
export type PrescriptionAlertCode =
  | 'ALLERGY'
  | 'DUPLICATE_CLASS'
  | 'INTERACTION'
  | 'MAX_SINGLE_DOSE'
  | 'MAX_DAILY_DOSE'
  | 'MAX_DOSE_PER_KG'
  | 'PREGNANCY'
  | 'MIN_AGE'
  | 'GERIATRIC'
  | 'RENAL'
  | 'HEPATIC';

export type PrescriptionAlert = {
  /** Index of the line in the prescription. */
  item: number;
  code: PrescriptionAlertCode;
  severity: AlertSeverity;
  /** Values for the message: substance, other drug, limit... */
  params: Record<string, string | number>;
};

export type CheckedLine = {
  label: string;
  drug: DrugInfo | null;
  atcCode: string | null;
  doseValue: number;
  doseUnit: string;
  frequency: Frequency;
};

export type PatientFacts = {
  ageMonths: number | null;
  weightKg: number | null;
  pregnant: boolean;
  allergies: { substance: string; atcCode: string | null }[];
  /** ICD-10 codes of active problems. */
  problemCodes: string[];
};

/** Treatment already running: active prescription lines of the patient. */
export type CurrentMedication = { label: string; atcCode: string | null };

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Same ATC level 4 (chemical subgroup, five characters). */
const sameClass = (a: string | null, b: string | null) =>
  Boolean(a && b && a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** ICD-10 chapters for renal failure (N17 to N19) and liver disease (K70 to K77). */
const RENAL = /^N1[7-9]/;
const HEPATIC = /^K7[0-7]/;

const INTERACTION_SEVERITY: Record<InteractionRule['severity'], AlertSeverity> = {
  minor: 'info',
  moderate: 'warning',
  major: 'blocking',
  contraindicated: 'blocking',
};

export function checkPrescription(
  lines: readonly CheckedLine[],
  patient: PatientFacts,
  rules: readonly InteractionRule[],
  current: readonly CurrentMedication[] = [],
): PrescriptionAlert[] {
  const alerts: PrescriptionAlert[] = [];
  const atcOf = (l: CheckedLine) => l.drug?.atcCode ?? l.atcCode ?? null;

  lines.forEach((line, item) => {
    const atc = atcOf(line);
    const drug = line.drug;
    const name = fold(drug?.inn ?? line.label);

    for (const allergy of patient.allergies) {
      const byCode =
        allergy.atcCode &&
        atc &&
        (atc.startsWith(allergy.atcCode) || sameClass(atc, allergy.atcCode));
      const substance = fold(allergy.substance);
      const byName =
        substance.length >= 4 && (name.includes(substance) || substance.includes(name));
      if (byCode || byName) {
        alerts.push({
          item,
          code: 'ALLERGY',
          severity: 'blocking',
          params: { substance: allergy.substance },
        });
        break;
      }
    }

    const others = [
      ...lines.slice(0, item).map((l) => ({ label: l.label, atcCode: atcOf(l) })),
      ...current,
    ];
    for (const other of others) {
      if (sameClass(atc, other.atcCode)) {
        alerts.push({
          item,
          code: 'DUPLICATE_CLASS',
          severity: 'warning',
          params: { other: other.label },
        });
        break;
      }
    }
    if (atc) {
      for (const other of others) {
        if (!other.atcCode) continue;
        const rule = rules.find(
          (r) =>
            (atc.startsWith(r.atcA) && other.atcCode!.startsWith(r.atcB)) ||
            (atc.startsWith(r.atcB) && other.atcCode!.startsWith(r.atcA)),
        );
        if (rule) {
          alerts.push({
            item,
            code: 'INTERACTION',
            severity: INTERACTION_SEVERITY[rule.severity],
            params: { other: other.label, message: rule.message },
          });
        }
      }
    }

    if (!drug) return;
    const sameUnit = !drug.doseUnit || fold(drug.doseUnit) === fold(line.doseUnit);
    if (sameUnit) {
      if (drug.maxSingleDose !== null && line.doseValue > drug.maxSingleDose) {
        alerts.push({
          item,
          code: 'MAX_SINGLE_DOSE',
          severity: 'blocking',
          params: { limit: drug.maxSingleDose, unit: line.doseUnit },
        });
      }
      const perDay = FREQUENCIES[line.frequency];
      const daily = perDay === null ? null : line.doseValue * Math.max(perDay, 1);
      if (daily !== null && drug.maxDailyDose !== null && daily > drug.maxDailyDose) {
        alerts.push({
          item,
          code: 'MAX_DAILY_DOSE',
          severity: 'blocking',
          params: { daily, limit: drug.maxDailyDose, unit: line.doseUnit },
        });
      }
      if (
        daily !== null &&
        drug.maxDailyDosePerKg !== null &&
        patient.weightKg !== null &&
        daily > drug.maxDailyDosePerKg * patient.weightKg
      ) {
        alerts.push({
          item,
          code: 'MAX_DOSE_PER_KG',
          severity: 'blocking',
          params: {
            daily,
            limit: Math.round(drug.maxDailyDosePerKg * patient.weightKg * 100) / 100,
            perKg: drug.maxDailyDosePerKg,
            unit: line.doseUnit,
          },
        });
      }
    }
    if (patient.pregnant && drug.pregnancyCategory) {
      const severity: AlertSeverity | null =
        drug.pregnancyCategory === 'X'
          ? 'blocking'
          : drug.pregnancyCategory === 'D'
            ? 'warning'
            : drug.pregnancyCategory === 'C'
              ? 'info'
              : null;
      if (severity) {
        alerts.push({
          item,
          code: 'PREGNANCY',
          severity,
          params: { category: drug.pregnancyCategory },
        });
      }
    }
    if (patient.ageMonths !== null) {
      if (drug.minAgeMonths !== null && patient.ageMonths < drug.minAgeMonths) {
        alerts.push({
          item,
          code: 'MIN_AGE',
          severity: 'blocking',
          params: { months: drug.minAgeMonths },
        });
      }
      if (drug.geriatricCaution && patient.ageMonths >= 65 * 12) {
        alerts.push({ item, code: 'GERIATRIC', severity: 'warning', params: {} });
      }
    }
    if (drug.renalCaution && patient.problemCodes.some((c) => RENAL.test(c))) {
      alerts.push({ item, code: 'RENAL', severity: 'warning', params: {} });
    }
    if (drug.hepaticCaution && patient.problemCodes.some((c) => HEPATIC.test(c))) {
      alerts.push({ item, code: 'HEPATIC', severity: 'warning', params: {} });
    }
  });
  return alerts;
}

/** Blocking alerts of a line that the prescriber has not overridden yet. */
export function unresolvedBlocking(
  alerts: readonly PrescriptionAlert[],
  item: number,
  acknowledged: readonly { code: string }[],
): PrescriptionAlert[] {
  return alerts.filter(
    (a) =>
      a.item === item && a.severity === 'blocking' && !acknowledged.some((k) => k.code === a.code),
  );
}
