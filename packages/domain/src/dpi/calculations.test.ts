import { describe, expect, it } from 'vitest';
import {
  bodyMassIndex,
  bodySurfaceArea,
  exactAge,
  news2,
  normalRangeFor,
  outOfRange,
  trendOf,
  vitalDefinitionInput,
} from './calculations';

describe('clinical calculations', () => {
  it('computes BMI and Mosteller body surface area', () => {
    expect(bodyMassIndex(70, 175)).toBe(22.9);
    expect(bodySurfaceArea(70, 175)).toBe(1.84);
    expect(bodyMassIndex(0, 175)).toBeNull();
  });

  it('gives the exact age in days, months or years', () => {
    expect(exactAge('2026-10-20', new Date('2026-11-02T00:00:00Z'))).toEqual({
      unit: 'days',
      value: 13,
    });
    expect(exactAge('2025-08-15', new Date('2026-11-02T00:00:00Z'))).toEqual({
      unit: 'months',
      value: 14,
    });
    expect(exactAge('1990-03-12', new Date('2026-11-02T00:00:00Z'))).toEqual({
      unit: 'years',
      value: 36,
    });
  });

  it('scores NEWS2 by the published bands, partial without consciousness and oxygen', () => {
    const normal = news2({ rr: 16, spo2: 98, sbp: 120, pulse: 75, temp: 37 });
    expect(normal).toMatchObject({ score: 0, risk: 'low', partial: true });
    const sick = news2({
      rr: 26,
      spo2: 92,
      onOxygen: true,
      sbp: 95,
      pulse: 120,
      consciousness: 'A',
      temp: 39.5,
    });
    // 3 + 2 + 2 + 2 + 2 + 0 + 2
    expect(sick).toMatchObject({ score: 13, risk: 'high', redScore: true, partial: false });
    expect(news2({ rr: 8, spo2: 97, sbp: 120, pulse: 70, temp: 37 })).toMatchObject({
      score: 3,
      risk: 'low_medium',
    });
    expect(news2({})).toBeNull();
  });

  it('reads trends with a stability margin', () => {
    expect(trendOf(38.5, 37.2)).toBe('up');
    expect(trendOf(37.3, 37.2)).toBe('stable');
    expect(trendOf(70, 80, 5)).toBe('down');
    expect(trendOf(70, null)).toBeNull();
  });

  it('applies the most specific configured normal range, and none by default', () => {
    const ranges = vitalDefinitionInput.parse({
      code: 'pulse',
      plausibleMin: 20,
      plausibleMax: 260,
      normalRanges: [
        { ageMinYears: 18, ageMaxYears: 130, low: 50, high: 100 },
        { sex: 'F', ageMinYears: 18, ageMaxYears: 130, low: 55, high: 105 },
      ],
    }).normalRanges;
    expect(normalRangeFor(ranges, 'F', 40)).toMatchObject({ low: 55 });
    expect(normalRangeFor(ranges, 'M', 40)).toMatchObject({ low: 50 });
    expect(normalRangeFor(ranges, 'M', 5)).toBeNull();
    expect(outOfRange(110, normalRangeFor(ranges, 'M', 40))).toBe('high');
    expect(outOfRange(110, null)).toBeNull();
  });
});
