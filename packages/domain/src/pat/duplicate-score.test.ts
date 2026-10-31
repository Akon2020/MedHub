import { describe, expect, it } from 'vitest';
import { duplicateScore, normalizePhone } from './duplicate-score';

const kabila = {
  familyName: 'Kabila',
  givenName: 'Jean',
  sex: 'M',
  birthDate: '1990-03-12',
  phone: '0991234567',
};

describe('duplicate score', () => {
  it('scores scenario P3 far above the candidate threshold', () => {
    const other = {
      ...kabila,
      birthDate: '1990-01-01',
      birthDateEstimated: true,
      phone: '+243 991 234 567',
    };
    expect(duplicateScore(kabila, other)).toEqual({
      score: 95,
      reasons: ['phonetic', 'name_similar', 'birth_year', 'phone'],
    });
  });

  it('gives the full birth date bonus only to two exact dates', () => {
    expect(duplicateScore(kabila, { ...kabila }).reasons).toContain('birth_date');
    expect(duplicateScore(kabila, { ...kabila }).score).toBe(110);
  });

  it('recognises spelling variants and penalises a different sex', () => {
    const variant = { familyName: 'Cabila', givenName: 'Jean', sex: 'F' };
    const result = duplicateScore(kabila, variant);
    expect(result.reasons).toEqual(['phonetic', 'sex_differs']);
    expect(result.score).toBe(-5);
  });

  it('counts a shared parent once', () => {
    const a = {
      familyName: 'Mbuyi',
      sex: 'F',
      motherName: 'Ilunga Marie',
      fatherName: 'Mbuyi Paul',
    };
    const b = {
      familyName: 'Tshibanda',
      sex: 'F',
      motherName: 'ILUNGA Marie',
      fatherName: 'Mbuyi Paul',
    };
    expect(duplicateScore(a, b)).toEqual({ score: 15, reasons: ['parent'] });
  });

  it('normalizes Congolese phone numbers', () => {
    expect(normalizePhone('0991234567')).toBe('+243991234567');
    expect(normalizePhone('00243 991 234 567')).toBe('+243991234567');
    expect(normalizePhone('243991234567')).toBe('+243991234567');
    expect(normalizePhone('')).toBeNull();
  });
});
