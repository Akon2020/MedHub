import type { CsvTable } from '@medhub/shared';
import { z } from 'zod';

/**
 * Consultation notes and coded diagnoses (docs/modules/dpi.md section 4).
 * A note is written as a local draft and synchronised only once signed; the
 * operation that carries it is signed by the device key over its canonical
 * content, so the note can be verified later. A signed note never changes: a
 * correction is a new note that supersedes it, the first one stays readable.
 */
export const NOTE_KINDS = ['consultation', 'progress', 'free'] as const;
export const NOTE_SECTIONS = ['complaint', 'history', 'examination', 'assessment', 'plan'] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

const sectionText = z.string().trim().max(10_000).nullish();

export const clinicalNotePayload = z
  .object({
    patientId: z.uuid(),
    encounterId: z.uuid().nullish(),
    kind: z.enum(NOTE_KINDS).default('consultation'),
    sections: z.object({
      complaint: sectionText,
      history: sectionText,
      examination: sectionText,
      assessment: sectionText,
      plan: sectionText,
    }),
    signedAt: z.iso.datetime(),
    supersedesId: z.uuid().nullish(),
    correctionReason: z.string().trim().min(3).max(300).nullish(),
  })
  .refine((n) => NOTE_SECTIONS.some((k) => (n.sections[k] ?? '').trim().length > 0), {
    message: 'DPI_NOTE_EMPTY',
    path: ['sections'],
  })
  .refine((n) => !n.supersedesId || Boolean(n.correctionReason), {
    message: 'DPI_CORRECTION_REASON_REQUIRED',
    path: ['correctionReason'],
  });
export type ClinicalNotePayload = z.infer<typeof clinicalNotePayload>;

export const DIAGNOSIS_SYSTEMS = ['ICD10', 'local'] as const;
export const DIAGNOSIS_CERTAINTIES = ['suspected', 'confirmed'] as const;

/** ICD-10 shape only: the codes themselves come from the structure's imported list. */
export const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,2})?$/;

export const diagnosisPayload = z
  .object({
    patientId: z.uuid(),
    encounterId: z.uuid().nullish(),
    codeSystem: z.enum(DIAGNOSIS_SYSTEMS).default('ICD10'),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .max(16)
      .nullish()
      .transform((c) => (c ? c : null)),
    label: z.string().trim().min(2).max(200),
    certainty: z.enum(DIAGNOSIS_CERTAINTIES),
    isPrimary: z.boolean().default(false),
    diagnosedAt: z.iso.datetime(),
    supersedesId: z.uuid().nullish(),
  })
  .refine((d) => d.codeSystem !== 'ICD10' || !d.code || ICD10_PATTERN.test(d.code), {
    message: 'DPI_ICD10_FORMAT',
    path: ['code'],
  });
export type DiagnosisPayload = z.infer<typeof diagnosisPayload>;

export type DiagnosisCatalogItem = { code: string; label: string; codeSystem: 'ICD10' | 'local' };
export type DiagnosisImportError = { line: number; message: string };

/**
 * Diagnosis list imported by the structure (CSV with the columns code and
 * label, system optional: ICD10 by default, or local). Checked before anything
 * is saved; duplicates and malformed ICD-10 codes are refused with their line.
 */
export function parseDiagnosisCatalog(table: CsvTable): {
  items: DiagnosisCatalogItem[];
  errors: DiagnosisImportError[];
} {
  const items: DiagnosisCatalogItem[] = [];
  const errors: DiagnosisImportError[] = [];
  const header = table.header.map((h) => h.trim().toLowerCase());
  // French files may name the label column "libelle".
  const col = (name: string) =>
    header.indexOf(name) >= 0 || name !== 'label'
      ? header.indexOf(name)
      : header.indexOf('libelle');
  if (col('code') < 0 || col('label') < 0) {
    return { items, errors: [{ line: 1, message: 'DPI_IMPORT_COLUMNS' }] };
  }
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const cell = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
    const code = cell('code').toUpperCase();
    const label = cell('label');
    const system = cell('system').toLowerCase() === 'local' ? 'local' : 'ICD10';
    if (!code || label.length < 2) {
      errors.push({ line, message: 'DPI_IMPORT_MISSING' });
      continue;
    }
    if (system === 'ICD10' && !ICD10_PATTERN.test(code)) {
      errors.push({ line, message: 'DPI_ICD10_FORMAT' });
      continue;
    }
    const key = `${system}:${code}`;
    if (seen.has(key)) {
      errors.push({ line, message: 'DPI_IMPORT_DUPLICATE' });
      continue;
    }
    seen.add(key);
    items.push({ code, label: label.slice(0, 200), codeSystem: system });
  }
  return { items, errors };
}

/** Accent- and case-insensitive search of the imported list, code or words of the label. */
export function searchDiagnoses(
  items: readonly DiagnosisCatalogItem[],
  query: string,
  limit = 12,
): DiagnosisCatalogItem[] {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  return items
    .filter((i) => {
      const hay = fold(`${i.code} ${i.label}`);
      return i.code.toLowerCase().startsWith(q) || words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}
