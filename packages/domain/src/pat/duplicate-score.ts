import { patientFullName } from './commands';
import { normalizeSearchText, phoneticKey, trigrams } from './search';

/** Documented defaults (docs/modules/pat.md); structures may change them. */
export const DUPLICATE_ALERT_SCORE = 50;
export const DUPLICATE_CANDIDATE_SCORE = 60;

export type DuplicateSubject = {
  familyName: string;
  middleName?: string | null;
  givenName?: string | null;
  sex: string;
  birthDate?: string | null;
  birthDateEstimated?: boolean;
  phone?: string | null;
  motherName?: string | null;
  fatherName?: string | null;
};

export type DuplicateReason =
  'phonetic' | 'name_similar' | 'birth_date' | 'birth_year' | 'phone' | 'parent' | 'sex_differs';

/**
 * One phone number, one form: "0991234567", "+243 991 234 567" and
 * "00243991234567" are the same Congolese number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^0\d{9}$/.test(digits)) digits = `+243${digits.slice(1)}`;
  if (/^243\d{9}$/.test(digits)) digits = `+${digits}`;
  return digits.length >= 6 ? digits : null;
}

function similarity(a: string, b: string): number {
  const ta = new Set(trigrams(a));
  const tb = new Set(trigrams(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return common / (ta.size + tb.size - common);
}

const year = (date: string | null | undefined) => (date ? date.slice(0, 4) : null);

/**
 * Deterministic similarity of two patients (docs/modules/pat.md, "Score de
 * doublon"): the same function warns at registration on a device and ranks
 * merge candidates on the server.
 */
export function duplicateScore(
  a: DuplicateSubject,
  b: DuplicateSubject,
): { score: number; reasons: DuplicateReason[] } {
  const reasons: DuplicateReason[] = [];
  let score = 0;
  const nameA = patientFullName(a);
  const nameB = patientFullName(b);
  const keyA = phoneticKey(nameA);
  if (keyA !== '' && keyA === phoneticKey(nameB)) {
    score += 35;
    reasons.push('phonetic');
  }
  if (similarity(nameA, nameB) > 0.7) {
    score += 20;
    reasons.push('name_similar');
  }
  const exactDates = a.birthDate && b.birthDate && !a.birthDateEstimated && !b.birthDateEstimated;
  if (exactDates && a.birthDate === b.birthDate) {
    score += 25;
    reasons.push('birth_date');
  } else if (year(a.birthDate) !== null && year(a.birthDate) === year(b.birthDate)) {
    score += 10;
    reasons.push('birth_year');
  }
  const phoneA = normalizePhone(a.phone);
  if (phoneA !== null && phoneA === normalizePhone(b.phone)) {
    score += 30;
    reasons.push('phone');
  }
  const parent = (v: string | null | undefined) => (v ? normalizeSearchText(v) : '');
  const sameMother = parent(a.motherName) !== '' && parent(a.motherName) === parent(b.motherName);
  const sameFather = parent(a.fatherName) !== '' && parent(a.fatherName) === parent(b.fatherName);
  if (sameMother || sameFather) {
    score += 15;
    reasons.push('parent');
  }
  if (a.sex !== 'U' && b.sex !== 'U' && a.sex !== b.sex) {
    score -= 40;
    reasons.push('sex_differs');
  }
  return { score, reasons };
}
