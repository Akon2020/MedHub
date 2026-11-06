import { describe, expect, it } from 'vitest';
import { allergyAddPayload, allergyStatus, groupDuplicates, type AllergyView } from './record';

const allergy = (over: Partial<AllergyView>): AllergyView => ({
  id: 'x',
  substance: 'Amoxicilline',
  category: 'drug',
  severity: 'moderate',
  reaction: null,
  certainty: 'confirmed',
  noneKnown: false,
  notedAt: '2026-11-02T08:00:00.000Z',
  status: 'active',
  ...over,
});

describe('allergies, history and problems', () => {
  it('shows active allergies most severe first, and "none known" only without any', () => {
    const rows = [
      allergy({ id: 'a', substance: 'Arachide', severity: 'mild' }),
      allergy({ id: 'b', severity: 'life_threatening' }),
      allergy({ id: 'c', noneKnown: true, substance: null, notedAt: '2026-11-01T08:00:00.000Z' }),
      allergy({ id: 'd', substance: 'Iode', status: 'retracted' }),
    ];
    const status = allergyStatus(rows);
    expect(status.allergies.map((a) => a.id)).toEqual(['b', 'a']);
    expect(status.noneKnownAt).toBeNull();
    expect(allergyStatus([rows[2] as AllergyView]).noneKnownAt).toBe('2026-11-01T08:00:00.000Z');
    expect(allergyStatus([]).noneKnownAt).toBeNull();
  });

  it('groups identical additions made on two devices for display only', () => {
    const rows = [
      { id: '1', label: 'Diabète', status: 'active' },
      { id: '2', label: 'diabète', status: 'active' },
      { id: '3', label: 'Diabète', status: 'retracted' },
    ];
    expect(groupDuplicates(rows, (r) => r.label.toLowerCase()).map((r) => r.id)).toEqual([
      '1',
      '3',
    ]);
  });

  it('checks the ATC code shape when one is given', () => {
    const base = {
      patientId: '01a19830-805e-7768-a65f-140ecc61aab9',
      substance: 'Amoxicilline',
      category: 'drug',
      severity: 'severe',
      notedAt: '2026-11-02T08:00:00.000Z',
    };
    expect(allergyAddPayload.safeParse({ ...base, atcCode: 'j01ca04' }).success).toBe(true);
    expect(allergyAddPayload.safeParse({ ...base, atcCode: 'penicilline' }).success).toBe(false);
  });
});
