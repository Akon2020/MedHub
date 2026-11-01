import { describe, expect, it } from 'vitest';
import { parsePatientQuery } from './search';

describe('patient search query', () => {
  it('separates the name from the birth year', () => {
    expect(parsePatientQuery('Kabila Jean 1990', 2026)).toMatchObject({
      text: 'kabila jean',
      year: 1990,
      phoneTail: null,
      mrn: null,
    });
  });

  it('recognises a phone number and a record number', () => {
    expect(parsePatientQuery('+243 991234567', 2026)).toMatchObject({
      text: '',
      phoneTail: '991234567',
    });
    expect(parsePatientQuery('kin-ab-26-00042', 2026)).toMatchObject({
      text: '',
      mrn: 'KIN-AB-26-00042',
    });
  });

  it('keeps a hyphenated name as text and ignores future years', () => {
    expect(parsePatientQuery('Kasa-Vubu 2999', 2026)).toMatchObject({
      text: 'kasa vubu 2999',
      year: null,
      mrn: null,
    });
  });
});
