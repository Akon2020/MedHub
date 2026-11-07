import { PLAN_B, planRules } from '@medhub/conventions';
import { describe, expect, it } from 'vitest';
import { lineFor } from '../fact/invoice';
import type { ServiceItem } from '../fact/pricing';
import { capConsumption, coverLine, voucherValid, type CoverageContext } from './coverage';

const services: Record<'consult' | 'scanner', ServiceItem> = {
  consult: {
    id: 's1',
    code: 'CONS-GEN',
    name: 'Consultation générale',
    category: 'consultation' as const,
    isActive: true,
  },
  scanner: {
    id: 's2',
    code: 'SCANNER',
    name: 'Scanner',
    category: 'imaging' as const,
    isActive: true,
  },
};
const catalog = {
  priceLists: [
    {
      id: 'pub',
      code: 'PUB',
      name: 'Public',
      kind: 'public' as const,
      currency: 'USD',
      isActive: true,
    },
    {
      id: 'conv',
      code: 'CONV',
      name: 'Convention',
      kind: 'contract' as const,
      currency: 'USD',
      isActive: true,
    },
  ],
  prices: [
    {
      priceListId: 'pub',
      serviceItemId: 's1',
      amount: 1200,
      currency: 'USD',
      validFrom: '2026-01-01',
      validUntil: null,
    },
    {
      priceListId: 'conv',
      serviceItemId: 's1',
      amount: 900,
      currency: 'USD',
      validFrom: '2026-01-01',
      validUntil: null,
    },
    {
      priceListId: 'pub',
      serviceItemId: 's2',
      amount: 15000,
      currency: 'USD',
      validFrom: '2026-01-01',
      validUntil: null,
    },
    {
      priceListId: 'conv',
      serviceItemId: 's2',
      amount: 12000,
      currency: 'USD',
      validFrom: '2026-01-01',
      validUntil: null,
    },
  ],
};
const context: CoverageContext = {
  contract: { id: 'c1', priceListId: 'conv', currency: 'USD' },
  plan: { id: 'p1', version: 2, rules: planRules.parse(PLAN_B) },
  member: {
    id: 'b1',
    status: 'active',
    validFrom: '2026-01-01',
    validUntil: null,
    isDayLaborer: false,
  },
};
const cover = (
  service: typeof services.consult,
  over: Partial<Parameters<typeof coverLine>[0]> = {},
) =>
  coverLine({
    line: lineFor(service, '2026-11-07', catalog, 'USD'),
    serviceItemId: service.id,
    day: '2026-11-07',
    performedAt: '2026-11-07T09:00:00.000Z',
    department: null,
    coverage: context,
    catalog,
    voucher: 'valid',
    emergency: false,
    priorAuthorization: { status: 'none' },
    consumption: { byCap: {}, hospitalDaysUsed: 0 },
    ...over,
  });

describe('coverage of an invoice line', () => {
  it('prices a covered act at the negotiated price and gives it to the payer', () => {
    const r = cover(services.consult);
    expect(r.line).toMatchObject({ unitPrice: 900, priceListId: 'conv' });
    expect(r).toMatchObject({
      payerShare: 900,
      contractId: 'c1',
      beneficiaryId: 'b1',
      decision: 'covered',
    });
    expect(r.coverage).toMatchObject({
      planCode: 'B',
      ruleVersion: 'p1@2',
      matchedRule: 'plateau-semi-complet',
    });
  });

  it('leaves an act the contract does not cover to the patient at the public price', () => {
    const r = cover(services.scanner);
    expect(r.line).toMatchObject({ unitPrice: 15000, priceListId: 'pub' });
    expect(r).toMatchObject({
      payerShare: 0,
      decision: 'needs_prior_authorization',
      action: 'block',
    });
    const approved = cover(services.scanner, {
      priorAuthorization: { status: 'approved', authorizedAmount: 10000 },
    });
    expect(approved.line.unitPrice).toBe(12000);
    expect(approved).toMatchObject({ payerShare: 10000, decision: 'partially_covered' });
  });

  it('blocks without voucher and covers an emergency to regularise', () => {
    expect(cover(services.consult, { voucher: 'missing' })).toMatchObject({
      payerShare: 0,
      decision: 'blocked',
    });
    expect(cover(services.consult, { voucher: 'missing', emergency: true })).toMatchObject({
      payerShare: 900,
      requires: ['voucher'],
    });
  });

  it('keeps a patient without contract and a line without price unchanged', () => {
    expect(cover(services.consult, { coverage: null })).toMatchObject({
      payerShare: 0,
      coverage: null,
      line: { unitPrice: 1200 },
    });
    const noPrice = coverLine({
      ...{
        serviceItemId: 's3',
        day: '2026-11-07',
        performedAt: '2026-11-07T09:00:00.000Z',
        department: null,
        coverage: context,
        catalog,
        voucher: 'valid' as const,
        emergency: false,
        priorAuthorization: { status: 'none' as const },
        consumption: { byCap: {}, hospitalDaysUsed: 0 },
      },
      line: {
        serviceItemId: 's3',
        code: 'X',
        label: 'Sans prix',
        category: 'other',
        quantity: 1,
        unitPrice: null,
        currency: 'USD',
        priceListId: null,
      },
    });
    expect(noPrice.coverage).toBeNull();
  });

  it('knows vouchers in force and the consumption of the caps', () => {
    const vouchers = [{ contractId: 'c1', issuedOn: '2026-11-01', validUntil: '2026-11-30' }];
    expect(voucherValid(vouchers, 'c1', '2026-11-07')).toBe(true);
    expect(voucherValid(vouchers, 'c1', '2026-12-01')).toBe(false);
    expect(voucherValid(vouchers, 'c2', '2026-11-07')).toBe(false);
    const plan = planRules.parse(PLAN_B);
    expect(
      capConsumption(
        plan,
        [
          {
            category: 'drug',
            code: 'MED',
            payerShare: 5000,
            performedAt: '2026-03-01T10:00:00.000Z',
            status: 'active',
          },
          {
            category: 'drug',
            code: 'MED',
            payerShare: 3000,
            performedAt: '2025-12-30T10:00:00.000Z',
            status: 'active',
          },
          {
            category: 'drug',
            code: 'MED',
            payerShare: 700,
            performedAt: '2026-04-01T10:00:00.000Z',
            status: 'superseded',
          },
          {
            category: 'lab',
            code: 'LAB-BASE',
            payerShare: 400,
            performedAt: '2026-04-01T10:00:00.000Z',
            status: 'active',
          },
        ],
        '2026-11-07',
      ),
    ).toEqual({ 'medicaments-annee': 5000 });
  });
});
