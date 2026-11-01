import { describe, expect, it } from 'vitest';
import {
  mergeClosure,
  mergePatch,
  mergeTarget,
  patientMergeSchema,
  unmergePatch,
  type Demographics,
} from './merge';

const survivor: Demographics = {
  familyName: 'Kabila',
  middleName: null,
  givenName: 'Jean',
  sex: 'M',
  birthDate: '1990-01-01',
  birthDateEstimated: true,
  phone: null,
};
const merged: Demographics = {
  ...survivor,
  birthDate: '1990-03-12',
  birthDateEstimated: false,
  phone: '0991234567',
};

describe('patient merge rules', () => {
  it('takes the chosen values of the merged record, birth date with its estimate flag', () => {
    expect(
      mergePatch(survivor, merged, { birthDate: 'merged', phone: 'merged', sex: 'merged' }),
    ).toEqual({
      birthDate: '1990-03-12',
      birthDateEstimated: false,
      phone: '0991234567',
    });
    expect(mergePatch(survivor, merged, {})).toEqual({});
  });

  it('undoes a merge without overwriting a value changed since', () => {
    const applied = { birthDate: '1990-03-12', birthDateEstimated: false, phone: '0991234567' };
    const current = { ...survivor, ...applied, phone: '0811111111' };
    expect(unmergePatch(survivor, applied, current)).toEqual({
      patch: { birthDate: '1990-01-01', birthDateEstimated: true },
      kept: ['phone'],
    });
  });

  it('follows chains of merges both ways', () => {
    const records = [
      { id: 'a', mergedIntoId: null },
      { id: 'b', mergedIntoId: 'a' },
      { id: 'c', mergedIntoId: 'b' },
      { id: 'd', mergedIntoId: null },
    ];
    expect(mergeClosure('a', records)).toEqual(['a', 'b', 'c']);
    const into = new Map(records.map((r) => [r.id, r.mergedIntoId]));
    expect(mergeTarget('c', (id) => into.get(id))).toBe('a');
    expect(mergeTarget('d', (id) => into.get(id))).toBe('d');
  });

  it('refuses to merge a record into itself', () => {
    const id = '0190f1a2-0000-7000-8000-000000000003';
    expect(
      patientMergeSchema.safeParse({ survivorId: id, mergedId: id, reason: 'Doublon' }).success,
    ).toBe(false);
  });
});
