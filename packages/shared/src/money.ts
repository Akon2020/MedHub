import { z } from 'zod';

/**
 * Money is always an integer amount of minor units plus an ISO 4217 code.
 * Floating point never touches an amount; exchange rates are decimal strings.
 */
export type CurrencyCode = string;

export type Money = {
  amount: number;
  currency: CurrencyCode;
};

export type CurrencyInfo = {
  code: CurrencyCode;
  minorUnit: number;
  symbol: string;
};

/** Reference data defaults; the authoritative list lives in the `currency` table. */
export const DEFAULT_CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { code: 'USD', minorUnit: 2, symbol: '$' },
  CDF: { code: 'CDF', minorUnit: 2, symbol: 'FC' },
};

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'CURRENCY_INVALID');

export const minorAmountSchema = z
  .number()
  .int()
  .refine((n) => Number.isSafeInteger(n), 'AMOUNT_OUT_OF_RANGE');

export const moneySchema = z.object({
  amount: minorAmountSchema,
  currency: currencyCodeSchema,
});

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amount)) throw new Error('AMOUNT_NOT_INTEGER');
  return { amount, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error('CURRENCY_MISMATCH');
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}

/**
 * Splits an amount by integer weights; remainders go to the first non-zero
 * shares so the parts always add up exactly to the total.
 */
export function allocateMoney(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new Error('ALLOCATION_EMPTY');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new Error('ALLOCATION_WEIGHT_INVALID');
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error('ALLOCATION_WEIGHT_INVALID');
  const sign = total.amount < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total.amount));
  const bigSum = BigInt(sum);
  const parts = weights.map((w) => Number((abs * BigInt(w)) / bigSum));
  let remainder = Number(abs) - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % parts.length) {
    if (weights[i] === 0) continue;
    parts[i] = (parts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return parts.map((p) => money(sign * p, total.currency));
}

/**
 * Converts using a decimal rate given as a string (numeric(18,6) on the server),
 * rounding half away from zero to the nearest minor unit.
 */
export function convertMoney(source: Money, rate: string, target: CurrencyCode): Money {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate);
  if (!match) throw new Error('EXCHANGE_RATE_INVALID');
  const scale = 1_000_000n;
  const rateScaled = BigInt(match[1] ?? '0') * scale + BigInt((match[2] ?? '').padEnd(6, '0'));
  const product = BigInt(source.amount) * rateScaled;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + scale / 2n) / scale;
  return money(Number(negative ? -rounded : rounded), target);
}

export function formatMoney(m: Money, locale = 'fr-CD', info?: CurrencyInfo): string {
  const meta = info ??
    DEFAULT_CURRENCIES[m.currency] ?? { code: m.currency, minorUnit: 2, symbol: m.currency };
  const value = m.amount / 10 ** meta.minorUnit;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: meta.minorUnit,
    maximumFractionDigits: meta.minorUnit,
  }).format(value);
}
