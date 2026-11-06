import { parseCsv } from '@medhub/shared';
import { describe, expect, it } from 'vitest';
import {
  clinicalNotePayload,
  diagnosisPayload,
  parseDiagnosisCatalog,
  searchDiagnoses,
} from './consultation';

const PATIENT = '0190a5e2-0000-7000-8000-000000000001';
const NOTE = '0190a5e2-0000-7000-8000-000000000002';
const AT = '2026-11-06T09:00:00.000Z';
const codes = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

describe('consultation note', () => {
  const sections = {
    complaint: 'Fièvre depuis trois jours',
    history: null,
    examination: null,
    assessment: null,
    plan: null,
  };

  it('accepts a note with at least one section and refuses an empty one', () => {
    expect(
      clinicalNotePayload.safeParse({ patientId: PATIENT, sections, signedAt: AT }).success,
    ).toBe(true);
    const empty = clinicalNotePayload.safeParse({
      patientId: PATIENT,
      sections: { ...sections, complaint: '   ' },
      signedAt: AT,
    });
    expect(codes(empty)).toContain('DPI_NOTE_EMPTY');
  });

  it('requires a reason to correct a signed note', () => {
    const base = { patientId: PATIENT, sections, signedAt: AT, supersedesId: NOTE };
    expect(codes(clinicalNotePayload.safeParse(base))).toContain('DPI_CORRECTION_REASON_REQUIRED');
    expect(
      clinicalNotePayload.safeParse({ ...base, correctionReason: 'Erreur de saisie' }).success,
    ).toBe(true);
  });
});

describe('diagnosis', () => {
  const base = {
    patientId: PATIENT,
    label: 'Diarrhée infectieuse',
    certainty: 'confirmed',
    diagnosedAt: AT,
  };

  it('checks the shape of an ICD-10 code, not of a local one', () => {
    expect(diagnosisPayload.safeParse({ ...base, code: 'a09' }).success).toBe(true);
    expect(diagnosisPayload.safeParse({ ...base, code: 'J18.9' }).success).toBe(true);
    expect(codes(diagnosisPayload.safeParse({ ...base, code: '18J' }))).toContain(
      'DPI_ICD10_FORMAT',
    );
    expect(
      diagnosisPayload.safeParse({ ...base, codeSystem: 'local', code: 'LOC-12' }).success,
    ).toBe(true);
  });

  it('allows a free label without a code', () => {
    const parsed = diagnosisPayload.parse({ ...base, code: '' });
    expect(parsed.code).toBeNull();
  });
});

describe('diagnosis list import', () => {
  it('reads valid rows and reports each bad line', () => {
    const csv = [
      'code;libelle;system',
      'A09;Diarrhée infectieuse;',
      'J18.9;Pneumopathie;ICD10',
      'B5X;Code mal formé;',
      'A09;Doublon;',
      'LOC-1;Liste locale;local',
      ';Sans code;',
    ].join('\n');
    const { items, errors } = parseDiagnosisCatalog(parseCsv(csv));
    expect(items.map((i) => `${i.codeSystem}:${i.code}`)).toEqual([
      'ICD10:A09',
      'ICD10:J18.9',
      'local:LOC-1',
    ]);
    expect(errors).toEqual([
      { line: 4, message: 'DPI_ICD10_FORMAT' },
      { line: 5, message: 'DPI_IMPORT_DUPLICATE' },
      { line: 7, message: 'DPI_IMPORT_MISSING' },
    ]);
  });

  it('refuses a file without the expected columns', () => {
    expect(parseDiagnosisCatalog(parseCsv('nom;valeur\nx;y')).errors).toEqual([
      { line: 1, message: 'DPI_IMPORT_COLUMNS' },
    ]);
  });

  it('searches by code prefix or by words of the label, accents ignored', () => {
    const items = [
      { code: 'A09', label: 'Diarrhée infectieuse', codeSystem: 'ICD10' as const },
      { code: 'J18.9', label: 'Pneumopathie, sans précision', codeSystem: 'ICD10' as const },
    ];
    expect(searchDiagnoses(items, 'j18').map((i) => i.code)).toEqual(['J18.9']);
    expect(searchDiagnoses(items, 'diarrhee').map((i) => i.code)).toEqual(['A09']);
    expect(searchDiagnoses(items, 'précision pneumo').map((i) => i.code)).toEqual(['J18.9']);
    expect(searchDiagnoses(items, 'x')).toEqual([]);
  });
});
