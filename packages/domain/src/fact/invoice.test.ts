import { describe, expect, it } from 'vitest';
import { billingRuleFor, canFinalize, invoiceLinePayload, invoiceTotals, lineFor } from './invoice';

const rule = (id: string, encounterKind: string | null, departmentId: string | null) => ({
  id,
  encounterKind,
  departmentId,
  serviceItemId: `svc-${id}`,
  isActive: true,
});

describe('invoice rules', () => {
  it('adds the lines, skips replaced ones and counts the missing prices', () => {
    const lines = [
      { quantity: 1, unitPrice: 1000 },
      { quantity: 3, unitPrice: 250 },
      { quantity: 1, unitPrice: null },
      { quantity: 1, unitPrice: 999, status: 'superseded' },
    ];
    expect(invoiceTotals(lines)).toEqual({ gross: 1750, missingPrices: 1 });
    expect(canFinalize(lines)).toBe(false);
    expect(canFinalize(lines.slice(0, 2))).toBe(true);
    expect(canFinalize([])).toBe(false);
  });

  it('chooses the most precise billing rule of a visit', () => {
    const rules = [
      rule('any', null, null),
      rule('kind', 'emergency', null),
      rule('both', 'outpatient', 'cons'),
      rule('dept', null, 'cons'),
    ];
    expect(billingRuleFor(rules, { kind: 'outpatient', departmentId: 'cons' })?.id).toBe('both');
    expect(billingRuleFor(rules, { kind: 'day_care', departmentId: 'cons' })?.id).toBe('dept');
    expect(billingRuleFor(rules, { kind: 'emergency', departmentId: null })?.id).toBe('kind');
    expect(billingRuleFor(rules, { kind: 'outpatient', departmentId: 'lab' })?.id).toBe('any');
    expect(
      billingRuleFor([{ ...rule('off', null, null), isActive: false }], {
        kind: 'outpatient',
        departmentId: null,
      }),
    ).toBeNull();
  });

  it('prices a line from the lists, or keeps it without price', () => {
    const service = {
      id: 's',
      code: 'CONS',
      name: 'Consultation',
      category: 'consultation' as const,
      isActive: true,
    };
    const catalog = {
      priceLists: [
        {
          id: 'p',
          code: 'PUB',
          name: 'Public',
          kind: 'public' as const,
          currency: 'USD',
          isActive: true,
        },
      ],
      prices: [
        {
          priceListId: 'p',
          serviceItemId: 's',
          amount: 1000,
          currency: 'USD',
          validFrom: '2026-01-01',
          validUntil: null,
        },
      ],
    };
    expect(lineFor(service, '2026-11-06', catalog, 'USD', 2)).toMatchObject({
      unitPrice: 1000,
      quantity: 2,
      priceListId: 'p',
    });
    expect(lineFor(service, '2025-06-01', catalog, 'CDF')).toMatchObject({
      unitPrice: null,
      currency: 'CDF',
    });
  });

  it('refuses negative or fractional quantities and prices', () => {
    const base = {
      invoiceId: '0190a5e2-0000-7000-8000-000000000001',
      patientId: '0190a5e2-0000-7000-8000-000000000002',
      label: 'Consultation',
      category: 'consultation',
      quantity: 1,
      unitPrice: 1000,
      currency: 'USD',
      performedAt: '2026-11-06T09:00:00.000Z',
    };
    expect(invoiceLinePayload.safeParse(base).success).toBe(true);
    expect(invoiceLinePayload.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(invoiceLinePayload.safeParse({ ...base, unitPrice: -1 }).success).toBe(false);
    expect(invoiceLinePayload.safeParse({ ...base, unitPrice: 10.5 }).success).toBe(false);
    expect(invoiceLinePayload.safeParse({ ...base, unitPrice: null }).success).toBe(true);
  });
});
