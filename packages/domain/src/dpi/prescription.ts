import type { CsvTable } from '@medhub/shared';
import { z } from 'zod';

/**
 * Prescription, drug catalogue and habitual treatments (docs/modules/dpi.md
 * section 5). The catalogue and the interaction rules are imported by each
 * structure (S9 decision: nothing preloaded).
 */

/** Structured frequencies and the number of intakes per day they imply (null: as needed). */
export const FREQUENCIES = {
  once: 0,
  '1x/d': 1,
  '2x/d': 2,
  '3x/d': 3,
  '4x/d': 4,
  q12h: 2,
  q8h: 3,
  q6h: 4,
  prn: null,
} as const;
export type Frequency = keyof typeof FREQUENCIES;
export const FREQUENCY_CODES = Object.keys(FREQUENCIES) as Frequency[];

export const ALERT_SEVERITIES = ['info', 'warning', 'blocking'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

const ATC = /^[A-Z](\d{2}([A-Z]([A-Z](\d{2})?)?)?)?$/;
const atc = z.string().trim().toUpperCase().regex(ATC);

export const acknowledgedAlert = z.object({
  code: z.string().min(1).max(40),
  severity: z.enum(ALERT_SEVERITIES),
  justification: z.string().trim().min(5).max(300),
});

export const prescriptionItemInput = z.object({
  drugId: z.uuid().nullish(),
  drugCode: z.string().trim().max(40).nullish(),
  label: z.string().trim().min(2).max(200),
  atcCode: atc.nullish(),
  doseValue: z.number().positive().finite(),
  doseUnit: z.string().trim().min(1).max(16),
  route: z.string().trim().max(40).nullish(),
  frequency: z.enum(FREQUENCY_CODES as [Frequency, ...Frequency[]]),
  durationDays: z.number().int().min(1).max(365).nullish(),
  quantity: z.number().nonnegative().finite().nullish(),
  instructions: z.string().trim().max(300).nullish(),
  substitutionAllowed: z.boolean().default(true),
  alertsAcknowledged: z.array(acknowledgedAlert).max(20).default([]),
});
export type PrescriptionItemInput = z.infer<typeof prescriptionItemInput>;

/** Code printed under the QR of the prescription: no ambiguous characters. */
export const VERIFICATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const VERIFICATION_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

export function newVerificationCode(random: (n: number) => Uint8Array): string {
  const bytes = random(10);
  return Array.from(bytes, (b) => VERIFICATION_ALPHABET[b % VERIFICATION_ALPHABET.length]).join('');
}

export const prescriptionCreatePayload = z.object({
  patientId: z.uuid(),
  encounterId: z.uuid().nullish(),
  kind: z.enum(['outpatient', 'discharge']).default('outpatient'),
  prescribedAt: z.iso.datetime(),
  verificationCode: z.string().regex(VERIFICATION_PATTERN),
  items: z.array(prescriptionItemInput).min(1).max(20),
  status: z.literal('active').default('active'),
});
export type PrescriptionCreatePayload = z.infer<typeof prescriptionCreatePayload>;

export const prescriptionCancelPayload = z.object({
  status: z.literal('cancelled').default('cancelled'),
  cancelReason: z.string().trim().min(3).max(300),
});

/** Every overridden blocking alert carries a justification (permission checked apart). */
export function overridesBlocking(payload: Pick<PrescriptionCreatePayload, 'items'>): boolean {
  return payload.items.some((i) => i.alertsAcknowledged.some((a) => a.severity === 'blocking'));
}

/** Quantity for the whole treatment, in dose units; null when it cannot be derived. */
export function computeQuantity(
  doseValue: number,
  frequency: Frequency,
  durationDays: number | null | undefined,
): number | null {
  if (frequency === 'once') return doseValue;
  const perDay = FREQUENCIES[frequency];
  if (perDay === null || !durationDays) return null;
  return Math.round(doseValue * perDay * durationDays * 1000) / 1000;
}

export const MEDICATION_SOURCES = ['patient_report', 'other_facility', 'record'] as const;

export const medicationStatementAddPayload = z.object({
  patientId: z.uuid(),
  label: z.string().trim().min(2).max(200),
  atcCode: atc.nullish(),
  dose: z.string().trim().max(120).nullish(),
  source: z.enum(MEDICATION_SOURCES).default('patient_report'),
  startedOn: z.iso.date().nullish(),
  notedAt: z.iso.datetime(),
  status: z.literal('active').default('active'),
});

export const medicationStatementStopPayload = z.object({
  status: z.literal('stopped').default('stopped'),
  stoppedOn: z.iso.date(),
  stopReason: z.string().trim().max(300).nullish(),
});

export const RECONCILIATION_DECISIONS = ['continue', 'stop', 'modify'] as const;

export const medicationReconciliationPayload = z.object({
  patientId: z.uuid(),
  encounterId: z.uuid().nullish(),
  kind: z.enum(['consultation', 'admission', 'discharge']).default('consultation'),
  decisions: z
    .array(
      z.object({
        statementId: z.uuid(),
        label: z.string().trim().min(1).max(200),
        decision: z.enum(RECONCILIATION_DECISIONS),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .min(1)
    .max(50),
  performedAt: z.iso.datetime(),
});

/** A drug of the structure's catalogue as the checks need it. */
export type DrugInfo = {
  code: string;
  inn: string;
  atcCode: string | null;
  form: string | null;
  strength: string | null;
  route: string | null;
  doseUnit: string | null;
  maxSingleDose: number | null;
  maxDailyDose: number | null;
  maxDailyDosePerKg: number | null;
  pregnancyCategory: 'A' | 'B' | 'C' | 'D' | 'X' | null;
  minAgeMonths: number | null;
  geriatricCaution: boolean;
  renalCaution: boolean;
  hepaticCaution: boolean;
  isControlled: boolean;
};

export const INTERACTION_SEVERITIES = ['minor', 'moderate', 'major', 'contraindicated'] as const;
export type InteractionRule = {
  atcA: string;
  atcB: string;
  severity: (typeof INTERACTION_SEVERITIES)[number];
  message: string;
};

export type CatalogImportError = { line: number; message: string };

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function columns(table: CsvTable) {
  const header = table.header.map(fold);
  return (cells: string[], ...names: string[]): string => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) return (cells[i] ?? '').trim();
    }
    return '';
  };
}

const YES = new Set(['oui', 'yes', 'o', 'y', '1', 'true', 'vrai', 'x']);

/**
 * Drug catalogue (CSV). Columns: code, dci, atc, forme, dosage, voie,
 * unite_dose, dose_max_prise, dose_max_jour, dose_max_kg_jour, grossesse
 * (A to X), age_min_mois, prudence_geriatrie, ajustement_renal,
 * ajustement_hepatique, controle. Only code and dci are required.
 */
export function parseDrugCatalog(table: CsvTable): {
  items: DrugInfo[];
  errors: CatalogImportError[];
} {
  const items: DrugInfo[] = [];
  const errors: CatalogImportError[] = [];
  const header = table.header.map(fold);
  if (!header.includes('code') || !(header.includes('dci') || header.includes('inn'))) {
    return { items, errors: [{ line: 1, message: 'PRESC_IMPORT_COLUMNS' }] };
  }
  const col = columns(table);
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const get = (...n: string[]) => col(cells, ...n);
    const code = get('code').toUpperCase();
    const inn = get('dci', 'inn');
    if (!code || inn.length < 2) {
      errors.push({ line, message: 'PRESC_IMPORT_MISSING' });
      continue;
    }
    const num = (...n: string[]): number | null | 'bad' => {
      const raw = get(...n).replace(',', '.');
      if (raw === '') return null;
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? v : 'bad';
    };
    const atcCode = get('atc').toUpperCase() || null;
    const pregnancy = get('grossesse', 'pregnancy').toUpperCase() || null;
    const values = {
      maxSingleDose: num('dose_max_prise', 'max_single_dose'),
      maxDailyDose: num('dose_max_jour', 'max_daily_dose'),
      maxDailyDosePerKg: num('dose_max_kg_jour', 'max_daily_dose_per_kg'),
      minAgeMonths: num('age_min_mois', 'min_age_months'),
    };
    if (
      (atcCode && !ATC.test(atcCode)) ||
      (pregnancy && !['A', 'B', 'C', 'D', 'X'].includes(pregnancy)) ||
      Object.values(values).includes('bad')
    ) {
      errors.push({ line, message: 'PRESC_IMPORT_VALUE' });
      continue;
    }
    if (seen.has(code)) {
      errors.push({ line, message: 'PRESC_IMPORT_DUPLICATE' });
      continue;
    }
    seen.add(code);
    const flag = (...n: string[]) => YES.has(get(...n).toLowerCase());
    items.push({
      code,
      inn: inn.slice(0, 120),
      atcCode,
      form: get('forme', 'form') || null,
      strength: get('dosage', 'strength') || null,
      route: get('voie', 'route') || null,
      doseUnit: get('unite_dose', 'dose_unit') || null,
      maxSingleDose: values.maxSingleDose as number | null,
      maxDailyDose: values.maxDailyDose as number | null,
      maxDailyDosePerKg: values.maxDailyDosePerKg as number | null,
      pregnancyCategory: pregnancy as DrugInfo['pregnancyCategory'],
      minAgeMonths: values.minAgeMonths as number | null,
      geriatricCaution: flag('prudence_geriatrie', 'geriatric_caution'),
      renalCaution: flag('ajustement_renal', 'renal_caution'),
      hepaticCaution: flag('ajustement_hepatique', 'hepatic_caution'),
      isControlled: flag('controle', 'controlled'),
    });
  }
  return { items, errors };
}

const SEVERITY_WORDS: Record<string, InteractionRule['severity']> = {
  mineure: 'minor',
  minor: 'minor',
  moderee: 'moderate',
  moderate: 'moderate',
  majeure: 'major',
  major: 'major',
  contre_indiquee: 'contraindicated',
  contraindicee: 'contraindicated',
  contraindicated: 'contraindicated',
};

/** Interaction rules (CSV): atc_a, atc_b (an ATC code or class prefix), gravite, message. */
export function parseInteractionRules(table: CsvTable): {
  items: InteractionRule[];
  errors: CatalogImportError[];
} {
  const items: InteractionRule[] = [];
  const errors: CatalogImportError[] = [];
  const header = table.header.map(fold);
  if (!['atc_a', 'atc_b', 'gravite', 'message'].every((c) => header.includes(c))) {
    return { items, errors: [{ line: 1, message: 'PRESC_IMPORT_COLUMNS' }] };
  }
  const col = columns(table);
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const a = col(cells, 'atc_a').toUpperCase();
    const b = col(cells, 'atc_b').toUpperCase();
    const severity = SEVERITY_WORDS[fold(col(cells, 'gravite'))];
    const message = col(cells, 'message');
    if (!a || !b || !message) {
      errors.push({ line, message: 'PRESC_IMPORT_MISSING' });
      continue;
    }
    if (!ATC.test(a) || !ATC.test(b) || !severity) {
      errors.push({ line, message: 'PRESC_IMPORT_VALUE' });
      continue;
    }
    const [atcA, atcB] = a <= b ? [a, b] : [b, a];
    const key = `${atcA}|${atcB}`;
    if (seen.has(key)) {
      errors.push({ line, message: 'PRESC_IMPORT_DUPLICATE' });
      continue;
    }
    seen.add(key);
    items.push({ atcA, atcB, severity, message: message.slice(0, 300) });
  }
  return { items, errors };
}

/** Accent- and case-insensitive search of the catalogue by code, INN or ATC. */
export function searchDrugs<T extends DrugInfo>(
  items: readonly T[],
  query: string,
  limit = 10,
): T[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const words = q.split('_');
  return items
    .filter((d) => {
      const hay = fold(`${d.code} ${d.inn} ${d.atcCode ?? ''} ${d.form ?? ''} ${d.strength ?? ''}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

export function drugLabel(d: Pick<DrugInfo, 'inn' | 'strength' | 'form'>): string {
  return [d.inn, d.strength, d.form].filter(Boolean).join(' ');
}
