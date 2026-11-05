import { describe, expect, it } from 'vitest';
import { childGrowth, growthZ, lmsAt, normalCdf, valueAtZ } from './engine';
import { WHO_GROWTH_SOURCE, WHO_GROWTH_TABLES as T } from './tables';

const round1 = (v: number) => Math.round(v * 10) / 10;

describe('WHO growth indicators', () => {
  it('reproduces the SD lines printed in the same WHO tables', () => {
    // Boys weight-for-age at birth: -3 SD 2.1 kg, -2 SD 2.5 kg, median 3.3 kg.
    const birth = lmsAt(T.M.weight_for_age, 0);
    if (!birth) throw new Error('table');
    expect([-3, -2, 0].map((z) => round1(valueAtZ(birth, z)))).toEqual([2.1, 2.5, 3.3]);
    // Girls weight-for-height at 65 cm: -2 SD 6.1 kg, median 7.2 kg.
    const girls65 = lmsAt(T.F.weight_for_height, 65);
    if (!girls65) throw new Error('table');
    expect([-2, 0].map((z) => round1(valueAtZ(girls65, z)))).toEqual([6.1, 7.2]);
  });

  it('gives a Z-score of 0 and the 50th percentile at the median', () => {
    expect(growthZ(T, 'M', 'weight_for_age', 0, 3.3464)).toEqual({ z: 0, percentile: 50 });
    expect(normalCdf(-2)).toBeCloseTo(0.02275, 4);
    expect(growthZ(T, 'F', 'height_for_age', 300, 150)).toBeNull();
  });

  it('flags wasting, stunting and a low MUAC', () => {
    const child = childGrowth({
      tables: T,
      sex: 'M',
      birthDate: '2024-11-05',
      at: new Date('2026-11-05T00:00:00Z'),
      weightKg: 8.5,
      heightCm: 80,
      muacMm: 112,
    });
    expect(child.ageMonths).toBe(24);
    expect(child.weightForHeight?.z).toBeLessThan(-2);
    expect(child.alerts).toEqual(
      expect.arrayContaining(['stunting', 'severe_underweight', 'muac_severe']),
    );
  });

  it('keeps the source of the tables', () => {
    expect(WHO_GROWTH_SOURCE.publisher).toBe('World Health Organization');
    expect(Object.keys(WHO_GROWTH_SOURCE.files)).toHaveLength(22);
  });
});
