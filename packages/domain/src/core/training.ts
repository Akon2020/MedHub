import type { PatientRegisterPayload } from '../pat/commands';

/** Prefix that marks a training structure code: HOP-KIN-0042 becomes FOR-KIN-0042. */
export const TRAINING_CODE_PREFIX = 'FOR';
export const TRAINING_PATIENT_COUNT = 40;

export function trainingCode(sourceCode: string): string {
  return `${TRAINING_CODE_PREFIX}${sourceCode.slice(3)}`;
}

/**
 * Invented names for invented patients: common family and given names, combined
 * at random, so that no real person is described (docs CLAUDE.md, section 9).
 */
const FAMILY_NAMES = [
  'Kabila',
  'Mbuyi',
  'Kasongo',
  'Ilunga',
  'Mukendi',
  'Tshibanda',
  'Lukusa',
  'Ngoy',
  'Kalala',
  'Mwamba',
  'Banza',
  'Nsimba',
  'Makiadi',
  'Lumbu',
  'Mutombo',
  'Kayembe',
  'Bokungu',
  'Mavungu',
  'Kitenge',
  'Nzuzi',
];
const GIVEN_FEMALE = [
  'Grâce',
  'Espérance',
  'Patience',
  'Divine',
  'Merveille',
  'Ruth',
  'Sarah',
  'Joëlle',
];
const GIVEN_MALE = [
  'Héritier',
  'Dieudonné',
  'Fiston',
  'Glody',
  'Christian',
  'Joël',
  'Patrick',
  'Daniel',
];

/** Small deterministic generator: the same training base gives the same patients. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function pick<T>(list: readonly T[], next: () => number): T {
  return list[Math.floor(next() * list.length)] as T;
}

/**
 * Fictitious patients of a training structure: names, sex, birth date (some
 * estimated). No phone number, so that no real number can appear by chance.
 */
export function fictitiousPatients(
  count: number,
  now: Date,
  seed = 2026,
): PatientRegisterPayload[] {
  const next = random(seed);
  const year = String(now.getUTCFullYear()).slice(2);
  return Array.from({ length: count }, (_, i) => {
    const sex = next() < 0.5 ? 'F' : 'M';
    const ageYears = Math.floor(next() * 80);
    const drawn = new Date(
      Date.UTC(
        now.getUTCFullYear() - ageYears,
        Math.floor(next() * 12),
        1 + Math.floor(next() * 28),
      ),
    );
    const birth = drawn > now ? now : drawn;
    const estimated = next() < 0.2;
    return {
      mrn: `${TRAINING_CODE_PREFIX}-${year}-${String(i + 1).padStart(5, '0')}`,
      familyName: pick(FAMILY_NAMES, next),
      middleName: next() < 0.5 ? pick(FAMILY_NAMES, next) : null,
      givenName: pick(sex === 'F' ? GIVEN_FEMALE : GIVEN_MALE, next),
      sex,
      birthDate: estimated ? `${birth.getUTCFullYear()}-01-01` : birth.toISOString().slice(0, 10),
      birthDateEstimated: estimated,
      phone: null,
      sensitivity: 'normal',
    };
  });
}
