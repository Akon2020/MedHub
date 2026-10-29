import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  checkVitalPlausibility,
  normalizeSearchText,
  patientSearchFields,
  phoneticKey,
  stockBalance,
  trigrams,
} from './index';

describe('search normalization', () => {
  it('removes accents, case and punctuation', () => {
    expect(normalizeSearchText('  Mbuyi-Kalala  Hélène ')).toBe('mbuyi kalala helene');
  });

  it('builds padded trigrams', () => {
    expect(trigrams('Ali')).toEqual(['  a', ' al', 'ali', 'li ']);
  });

  it('gives spelling variants the same phonetic key', () => {
    expect(phoneticKey('Kabwe')).toBe(phoneticKey('Cabwe'));
    expect(phoneticKey('Mbouyi')).toBe(phoneticKey('Mbuyi'));
    expect(phoneticKey('Philippe')).toBe(phoneticKey('Filipe'));
    expect(phoneticKey('Tshibanda')).toBe(phoneticKey('Tshibandda'));
  });

  it('derives search fields for a patient', () => {
    const fields = patientSearchFields({
      familyName: 'Ilunga',
      givenName: 'Grâce',
      mrn: 'KIN-AB-26-00001',
    });
    expect(fields.searchText).toBe('ilunga grace kin ab 26 00001');
  });
});

describe('patient commands', () => {
  it('accepts a quick registration', () => {
    const parsed = COMMANDS['patient.register'].payloadSchema.parse({
      mrn: 'KIN-AB-26-00001',
      familyName: 'Ilunga',
      sex: 'F',
    });
    expect(parsed.sensitivity).toBe('normal');
  });

  it('rejects an empty update', () => {
    expect(COMMANDS['patient.update'].payloadSchema.safeParse({}).success).toBe(false);
  });
});

describe('vital sign plausibility', () => {
  it('requires a reason outside plausible bounds', () => {
    expect(checkVitalPlausibility({ code: 'temp', value: 52 })).toEqual({
      ok: false,
      reason: 'DPI_VITAL_IMPLAUSIBLE',
    });
    expect(
      checkVitalPlausibility({
        code: 'temp',
        value: 52,
        plausibilityOverrideReason: 'Thermomètre vérifié',
      }),
    ).toEqual({ ok: true });
    expect(checkVitalPlausibility({ code: 'temp', value: 37.2 })).toEqual({ ok: true });
  });
});

describe('stock', () => {
  it('computes the balance from movements only', () => {
    expect(
      stockBalance([
        { kind: 'receipt', quantity: 100 },
        { kind: 'dispense', quantity: 30 },
        { kind: 'adjustment_minus', quantity: 5 },
        { kind: 'return_patient', quantity: 2 },
      ]),
    ).toBe(67);
  });
});
