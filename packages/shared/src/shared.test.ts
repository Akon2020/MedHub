import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HybridLogicalClock,
  ManualClock,
  allocateMoney,
  canonicalJson,
  compareHlc,
  convertMoney,
  formatHlc,
  isTenantCode,
  isUuidV7,
  money,
  normalizeTenantCode,
  parseHlc,
  uuidv7,
} from './index';

describe('uuidv7', () => {
  it('produces time-ordered v7 identifiers', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('HybridLogicalClock', () => {
  it('never goes backwards even if the wall clock does', () => {
    const clock = new ManualClock(1_000);
    const hlc = new HybridLogicalClock(clock, 'A');
    const a = hlc.now();
    clock.set(500);
    const b = hlc.now();
    expect(compareHlc(a, b)).toBe(-1);
    expect(parseHlc(b).physical).toBe(1_000);
  });

  it('moves past a remote timestamp from the future', () => {
    const clock = new ManualClock(1_000);
    const hlc = new HybridLogicalClock(clock, 'A');
    const remote = formatHlc({ physical: 5_000, counter: 3, node: 'B' });
    const local = hlc.receive(remote);
    expect(compareHlc(remote, local)).toBe(-1);
  });

  it('string order matches logical order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 45 }),
        fc.integer({ min: 0, max: 999_999 }),
        fc.integer({ min: 0, max: 2 ** 45 }),
        fc.integer({ min: 0, max: 999_999 }),
        (p1, c1, p2, c2) => {
          const a = formatHlc({ physical: p1, counter: c1, node: 'X' });
          const b = formatHlc({ physical: p2, counter: c2, node: 'X' });
          const lexical = a < b ? -1 : a > b ? 1 : 0;
          expect(compareHlc(a, b)).toBe(lexical);
        },
      ),
    );
  });
});

describe('money', () => {
  it('allocation always sums to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc
          .array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 })
          .filter((w) => w.some((x) => x > 0)),
        (amount, weights) => {
          const parts = allocateMoney(money(amount, 'USD'), weights);
          expect(parts.reduce((acc, p) => acc + p.amount, 0)).toBe(amount);
        },
      ),
    );
  });

  it('converts with half-up rounding on decimal rates', () => {
    expect(convertMoney(money(1_000, 'USD'), '2850.5', 'CDF')).toEqual(money(2_850_500, 'CDF'));
    expect(convertMoney(money(1, 'USD'), '0.005', 'CDF')).toEqual(money(0, 'CDF'));
    expect(convertMoney(money(100, 'USD'), '0.005', 'CDF')).toEqual(money(1, 'CDF'));
  });

  it('refuses non-integer amounts', () => {
    expect(() => money(1.5, 'USD')).toThrow('AMOUNT_NOT_INTEGER');
  });
});

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }),
    );
  });
});

describe('tenant code', () => {
  it('normalizes case and spaces', () => {
    expect(normalizeTenantCode(' hop-dem-0001 ')).toBe('HOP-DEM-0001');
    expect(isTenantCode('hop-dem-0001')).toBe(true);
    expect(isTenantCode('HOP-DEM-01')).toBe(false);
  });
});
