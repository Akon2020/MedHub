import { describe, expect, it } from 'vitest';
import {
  cashSessionClosePayload,
  expectedCash,
  invoiceBalance,
  paymentReceivePayload,
  quote,
  sessionTotals,
  settlement,
} from './payment';
import { rateFor } from './pricing';

const rates = [{ from: 'USD', to: 'CDF', rate: '2865.5', validFrom: '2026-11-05' }];
const usdToCdf = rateFor(rates, 'USD', 'CDF', '2026-11-06')!;

describe('cash desk arithmetic', () => {
  it('pays a USD invoice in CDF cash at the rate of the day, rounded to 50 CDF, with change', () => {
    const q = quote(1200, 'USD', 'CDF', usdToCdf, 'cash', 5000);
    // 12.00 USD = 34 386.00 CDF, asked 34 400 CDF (rounding +14 CDF)
    expect(q).toEqual({ exact: 3438600, due: 3440000, roundingAdjustment: 1400 });
    expect(settlement(3500000, q, 1200, 'USD', 'CDF', usdToCdf)).toEqual({
      amount: 3440000,
      amountInInvoiceCurrency: 1200,
      roundingAdjustment: 1400,
      change: 60000,
    });
  });

  it('does not round other methods nor the invoice currency', () => {
    expect(quote(1200, 'USD', 'CDF', usdToCdf, 'mobile_money', 5000).due).toBe(3438600);
    expect(quote(1250, 'USD', 'USD', null, 'cash', 0)).toEqual({
      exact: 1250,
      due: 1250,
      roundingAdjustment: 0,
    });
  });

  it('settles a partial payment converted back, never more than the balance', () => {
    const q = quote(1200, 'USD', 'CDF', usdToCdf, 'cash', 5000);
    // 10 000 CDF = 3.49 USD settled
    expect(settlement(1000000, q, 1200, 'USD', 'CDF', usdToCdf)).toEqual({
      amount: 1000000,
      amountInInvoiceCurrency: 349,
      roundingAdjustment: 0,
      change: 0,
    });
  });

  it('derives the paid state and the expected cash of a session', () => {
    expect(invoiceBalance(1200, [])).toEqual({ paid: 0, remaining: 1200, state: 'unpaid' });
    expect(invoiceBalance(1200, [{ amountInInvoiceCurrency: 349 }]).state).toBe('partially_paid');
    expect(
      invoiceBalance(1200, [{ amountInInvoiceCurrency: 349 }, { amountInInvoiceCurrency: 851 }])
        .state,
    ).toBe('paid');
    const payments = [
      { method: 'cash', currency: 'CDF', amount: 3440000 },
      { method: 'cash', currency: 'USD', amount: 1000 },
      { method: 'mobile_money', currency: 'CDF', amount: 500000 },
      { method: 'cash', currency: 'USD', amount: -200 },
    ];
    expect(expectedCash({ CDF: 1000000, USD: 0 }, payments)).toEqual({ CDF: 4440000, USD: 800 });
    expect(sessionTotals(payments)).toEqual({
      cash: { CDF: 3440000, USD: 800 },
      mobile_money: { CDF: 500000 },
    });
  });
});

describe('payment and closing payloads', () => {
  const base = {
    patientId: '0190a5e2-0000-7000-8000-000000000001',
    invoiceId: '0190a5e2-0000-7000-8000-000000000002',
    cashSessionId: '0190a5e2-0000-7000-8000-000000000003',
    method: 'cash',
    currency: 'USD',
    amount: 1200,
    invoiceCurrency: 'USD',
    amountInInvoiceCurrency: 1200,
    exchangeRate: null,
    exchangeRateDate: null,
    receiptNumber: 'REC-KIN-AA-2026-000001',
    receivedAt: '2026-11-06T10:00:00.000Z',
  };

  it('needs a rate in another currency and a reference for mobile money', () => {
    expect(paymentReceivePayload.safeParse(base).success).toBe(true);
    expect(paymentReceivePayload.safeParse({ ...base, currency: 'CDF' }).success).toBe(false);
    expect(paymentReceivePayload.safeParse({ ...base, method: 'mobile_money' }).success).toBe(
      false,
    );
    expect(
      paymentReceivePayload.safeParse({
        ...base,
        method: 'mobile_money',
        reference: 'TX123',
        operator: 'mpesa',
      }).success,
    ).toBe(true);
    expect(paymentReceivePayload.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(paymentReceivePayload.safeParse({ ...base, amount: 12.5 }).success).toBe(false);
  });

  it('requires a justification to close with a variance', () => {
    const close = {
      closedAt: '2026-11-06T17:00:00.000Z',
      expected: { CDF: 4440000 },
      counted: { CDF: 4430000 },
    };
    expect(cashSessionClosePayload.safeParse(close).success).toBe(false);
    expect(
      cashSessionClosePayload.safeParse({ ...close, justification: 'Billet de 100 FC manquant' })
        .success,
    ).toBe(true);
    expect(cashSessionClosePayload.safeParse({ ...close, counted: { CDF: 4440000 } }).success).toBe(
      true,
    );
  });
});
