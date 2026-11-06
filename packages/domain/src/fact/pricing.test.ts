import { money, parseCsv } from '@medhub/shared';
import { describe, expect, it } from 'vitest';
import {
  convertWith,
  parseAmount,
  parsePrices,
  parseServiceItems,
  rateFor,
  resolvePrice,
  roundCash,
  type Price,
  type PriceList,
} from './pricing';

const lists: PriceList[] = [
  { id: 'pub', code: 'PUB', name: 'Public', kind: 'public', currency: 'USD', isActive: true },
  { id: 'ind', code: 'IND', name: 'Indigents', kind: 'indigent', currency: 'USD', isActive: true },
  {
    id: 'conv',
    code: 'CONV',
    name: 'Convention',
    kind: 'contract',
    currency: 'USD',
    isActive: true,
  },
  { id: 'old', code: 'OLD', name: 'Ancienne', kind: 'private', currency: 'USD', isActive: false },
];
const price = (
  priceListId: string,
  amount: number,
  validFrom: string,
  validUntil: string | null = null,
): Price => ({
  priceListId,
  serviceItemId: 'consult',
  amount,
  currency: 'USD',
  validFrom,
  validUntil,
});
const prices = [
  price('pub', 1000, '2026-01-01', '2026-07-01'),
  price('pub', 1200, '2026-07-01'),
  price('ind', 200, '2026-01-01'),
  price('conv', 800, '2026-01-01'),
  price('old', 1, '2026-01-01'),
];

describe('price resolution', () => {
  it('takes the coverage list, then the patient kind, then the public list', () => {
    const base = { serviceItemId: 'consult', day: '2026-11-06' };
    expect(
      resolvePrice(
        { ...base, coveragePriceListId: 'conv', patientKind: 'indigent' },
        lists,
        prices,
      ),
    ).toEqual({
      priceListId: 'conv',
      unitPrice: money(800, 'USD'),
    });
    expect(resolvePrice({ ...base, patientKind: 'indigent' }, lists, prices)?.priceListId).toBe(
      'ind',
    );
    expect(resolvePrice({ ...base, patientKind: 'private' }, lists, prices)?.priceListId).toBe(
      'pub',
    );
  });

  it('uses the price in force on the day of the act', () => {
    expect(
      resolvePrice({ serviceItemId: 'consult', day: '2026-06-30' }, lists, prices)?.unitPrice
        .amount,
    ).toBe(1000);
    expect(
      resolvePrice({ serviceItemId: 'consult', day: '2026-07-01' }, lists, prices)?.unitPrice
        .amount,
    ).toBe(1200);
    expect(resolvePrice({ serviceItemId: 'consult', day: '2025-12-31' }, lists, prices)).toBeNull();
    expect(resolvePrice({ serviceItemId: 'unknown', day: '2026-11-06' }, lists, prices)).toBeNull();
  });
});

describe('exchange rates and cash', () => {
  const rates = [
    { from: 'USD', to: 'CDF', rate: '2850', validFrom: '2026-11-01' },
    { from: 'USD', to: 'CDF', rate: '2865.5', validFrom: '2026-11-05' },
  ];

  it('takes the last known rate and says when it is not the rate of the day', () => {
    expect(rateFor(rates, 'USD', 'CDF', '2026-11-05')).toEqual({
      rate: '2865.5',
      validFrom: '2026-11-05',
      inverse: false,
      stale: false,
    });
    expect(rateFor(rates, 'USD', 'CDF', '2026-11-06')?.stale).toBe(true);
    expect(rateFor(rates, 'CDF', 'USD', '2026-11-06')?.inverse).toBe(true);
    expect(rateFor(rates, 'USD', 'CDF', '2026-10-31')).toBeNull();
    expect(rateFor(rates, 'USD', 'EUR', '2026-11-06')).toBeNull();
  });

  it('converts both ways with exact integer arithmetic', () => {
    const day = rateFor(rates, 'USD', 'CDF', '2026-11-06')!;
    // 12.00 USD at 2865.5 = 34 386.00 CDF
    expect(convertWith(money(1200, 'USD'), day, 'CDF')).toEqual(money(3438600, 'CDF'));
    const back = rateFor(rates, 'CDF', 'USD', '2026-11-06')!;
    // 34 386.00 CDF back to USD = 12.00 USD; 10 000 CDF = 3.49 USD (3.4898...)
    expect(convertWith(money(3438600, 'CDF'), back, 'USD')).toEqual(money(1200, 'USD'));
    expect(convertWith(money(1000000, 'CDF'), back, 'USD')).toEqual(money(349, 'USD'));
  });

  it('rounds cash to the step, halves upwards', () => {
    expect(roundCash(3438600, 5000)).toBe(3440000);
    expect(roundCash(3437400, 5000)).toBe(3435000);
    expect(roundCash(3437500, 5000)).toBe(3440000);
    expect(roundCash(1234, 0)).toBe(1234);
    expect(roundCash(-3437500, 5000)).toBe(-3440000);
  });

  it('reads amounts typed in major units', () => {
    expect(parseAmount('12,50', 2)).toBe(1250);
    expect(parseAmount('15 000', 2)).toBe(1500000);
    expect(parseAmount('1.234', 2)).toBeNull();
    expect(parseAmount('-5', 2)).toBeNull();
    expect(parseAmount('abc', 2)).toBeNull();
  });
});

describe('finance imports', () => {
  it('reads service items with French categories', () => {
    const { items, errors } = parseServiceItems(
      parseCsv(
        'code;libelle;categorie\nCONS-GEN;Consultation générale;consultation\nGE;Goutte épaisse;laboratoire\nX;Inconnu;magie\nGE;Doublon;laboratoire',
      ),
    );
    expect(items).toEqual([
      { code: 'CONS-GEN', name: 'Consultation générale', category: 'consultation', isActive: true },
      { code: 'GE', name: 'Goutte épaisse', category: 'lab', isActive: true },
    ]);
    expect(errors.map((e) => e.message)).toEqual(['FACT_IMPORT_CATEGORY', 'FACT_IMPORT_DUPLICATE']);
  });

  it('reads dated prices in minor units', () => {
    const { items, errors } = parsePrices(
      parseCsv(
        'code;montant;debut;fin\nCONS-GEN;10;2026-01-01;\nGE;3,50;2026-01-01;2026-12-31\nGE;abc;2026-01-01;\nCONS-GEN;12;2026-07-01;2026-06-01',
      ),
      2,
    );
    expect(items).toEqual([
      { line: 2, serviceCode: 'CONS-GEN', amount: 1000, validFrom: '2026-01-01', validUntil: null },
      {
        line: 3,
        serviceCode: 'GE',
        amount: 350,
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
      },
    ]);
    expect(errors.map((e) => e.line)).toEqual([4, 5]);
  });
});
