import { convertMoney, money, type CsvTable, type Money } from '@medhub/shared';
import { z } from 'zod';

/**
 * Pricing (docs/modules/fact.md section 1): service items, price lists with
 * dated prices, exchange rates and cash rounding. Pure rules shared by the
 * workstation (offline cash desk) and the server.
 */
export const SERVICE_CATEGORIES = [
  'consultation',
  'procedure',
  'lab',
  'imaging',
  'bed_day',
  'drug',
  'consumable',
  'other',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const PRICE_LIST_KINDS = [
  'public',
  'private',
  'contract',
  'foreigner',
  'staff',
  'indigent',
] as const;
export type PriceListKind = (typeof PRICE_LIST_KINDS)[number];

export type ServiceItem = {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  isActive: boolean;
};
export type PriceList = {
  id: string;
  code: string;
  name: string;
  kind: PriceListKind;
  currency: string;
  isActive: boolean;
};
/** `validFrom` and `validUntil` are calendar days (YYYY-MM-DD), `validUntil` excluded. */
export type Price = {
  priceListId: string;
  serviceItemId: string;
  amount: number;
  currency: string;
  validFrom: string;
  validUntil: string | null;
};

export type ResolvedPrice = { priceListId: string; unitPrice: Money };

/**
 * Price of a service on a day (docs/modules/fact.md 1): the list of the
 * patient's coverage, else the list of the patient's kind, else the public
 * list; within a list, the price in force that day. Null means FACT_NO_PRICE:
 * the act is still recorded and flagged to the cash desk.
 */
export function resolvePrice(
  input: {
    serviceItemId: string;
    day: string;
    coveragePriceListId?: string | null;
    patientKind?: PriceListKind | null;
  },
  lists: readonly PriceList[],
  prices: readonly Price[],
): ResolvedPrice | null {
  const active = lists.filter((l) => l.isActive);
  const candidates = [
    input.coveragePriceListId ? active.find((l) => l.id === input.coveragePriceListId) : undefined,
    input.patientKind ? active.find((l) => l.kind === input.patientKind) : undefined,
    active.find((l) => l.kind === 'public'),
  ].filter((l): l is PriceList => Boolean(l));
  for (const list of candidates) {
    const price = prices
      .filter(
        (p) =>
          p.priceListId === list.id &&
          p.serviceItemId === input.serviceItemId &&
          p.validFrom <= input.day &&
          (p.validUntil === null || input.day < p.validUntil),
      )
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    if (price) return { priceListId: list.id, unitPrice: money(price.amount, price.currency) };
  }
  return null;
}

/** A rate "1 from = rate to", decimal string with at most six decimals, in force from a day. */
export type ExchangeRate = { from: string; to: string; rate: string; validFrom: string };

export const RATE_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;

export type RateChoice = { rate: string; validFrom: string; inverse: boolean; stale: boolean };

/**
 * Rate to convert `from` into `to` on `day` (owner decision S10: the last rate
 * known, with a warning when it is not the rate of the day; never blocking).
 */
export function rateFor(
  rates: readonly ExchangeRate[],
  from: string,
  to: string,
  day: string,
): RateChoice | null {
  const usable = rates
    .filter((r) => r.validFrom <= day)
    .filter((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const best = usable[0];
  if (!best) return null;
  return {
    rate: best.rate,
    validFrom: best.validFrom,
    inverse: best.from !== from,
    stale: best.validFrom < day,
  };
}

/** Converts an amount with a chosen rate, dividing for an inverse pair; half away from zero. */
export function convertWith(amount: Money, choice: RateChoice, target: string): Money {
  if (!choice.inverse) return convertMoney(amount, choice.rate, target);
  const [whole = '0', frac = ''] = choice.rate.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
  if (scaled === 0n) throw new Error('EXCHANGE_RATE_INVALID');
  const numerator = BigInt(amount.amount) * 1_000_000n;
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + scaled) / (scaled * 2n);
  return money(Number(negative ? -rounded : rounded), target);
}

/**
 * Cash rounding step per currency in minor units (owner decision S10:
 * adjustable, 50 CDF by default, USD not rounded). A structure may set its own.
 */
export const DEFAULT_CASH_ROUNDING: Readonly<Record<string, number>> = { CDF: 5000 };

/** Rounds a cash amount to the nearest step, halves upwards; the difference is shown apart. */
export function roundCash(amount: number, step: number): number {
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(step) || step < 0) {
    throw new Error('ROUNDING_INVALID');
  }
  if (step <= 1) return amount;
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  return sign * Math.floor((abs + step / 2) / step) * step;
}

/** Parses an amount typed in major units ("12,50", "15000") into minor units. */
export function parseAmount(text: string, minorUnit: number): number | null {
  const clean = text.trim().replace(/\s/g, '').replace(',', '.');
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(clean);
  if (!match) return null;
  const frac = match[2] ?? '';
  if (frac.length > minorUnit) return null;
  const value =
    BigInt(match[1] ?? '0') * 10n ** BigInt(minorUnit) + BigInt(frac.padEnd(minorUnit, '0') || '0');
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export const serviceItemInput = z.object({
  id: z.uuid().nullish(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/),
  name: z.string().trim().min(2).max(160),
  category: z.enum(SERVICE_CATEGORIES),
  isActive: z.boolean().default(true),
});
export type ServiceItemInput = z.infer<typeof serviceItemInput>;

export const priceListInput = z.object({
  id: z.uuid().nullish(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(PRICE_LIST_KINDS),
  currency: z.string().regex(/^[A-Z]{3}$/),
  isActive: z.boolean().default(true),
});
export type PriceListInput = z.infer<typeof priceListInput>;

export const exchangeRateInput = z.object({
  from: z.string().regex(/^[A-Z]{3}$/),
  to: z.string().regex(/^[A-Z]{3}$/),
  rate: z
    .string()
    .regex(RATE_PATTERN)
    .refine((r) => Number(r) > 0, 'FACT_RATE_INVALID'),
  validFrom: z.iso.date(),
});

export type FinanceImportError = { line: number; message: string };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const CATEGORY_WORDS: Record<string, ServiceCategory> = {
  consultation: 'consultation',
  acte: 'procedure',
  procedure: 'procedure',
  laboratoire: 'lab',
  lab: 'lab',
  imagerie: 'imaging',
  imaging: 'imaging',
  hospitalisation: 'bed_day',
  journee: 'bed_day',
  bed_day: 'bed_day',
  medicament: 'drug',
  drug: 'drug',
  consommable: 'consumable',
  consumable: 'consumable',
  autre: 'other',
  other: 'other',
};

/** Service items (CSV): code, libelle, categorie. */
export function parseServiceItems(table: CsvTable): {
  items: Omit<ServiceItemInput, 'id'>[];
  errors: FinanceImportError[];
} {
  const header = table.header.map(fold);
  const col = (cells: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return (cells[i] ?? '').trim();
    }
    return '';
  };
  const items: Omit<ServiceItemInput, 'id'>[] = [];
  const errors: FinanceImportError[] = [];
  if (!header.includes('code') || !(header.includes('libelle') || header.includes('name'))) {
    return { items, errors: [{ line: 1, message: 'FACT_IMPORT_COLUMNS' }] };
  }
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const category = CATEGORY_WORDS[fold(col(cells, 'categorie', 'category'))];
    const parsed = serviceItemInput.safeParse({
      code: col(cells, 'code'),
      name: col(cells, 'libelle', 'name'),
      category,
    });
    if (!parsed.success) {
      errors.push({ line, message: category ? 'FACT_IMPORT_VALUE' : 'FACT_IMPORT_CATEGORY' });
      continue;
    }
    if (seen.has(parsed.data.code)) {
      errors.push({ line, message: 'FACT_IMPORT_DUPLICATE' });
      continue;
    }
    seen.add(parsed.data.code);
    const { id: _id, ...rest } = parsed.data;
    items.push(rest);
  }
  return { items, errors };
}

export type PriceImportRow = {
  line: number;
  serviceCode: string;
  amount: number;
  validFrom: string;
  validUntil: string | null;
};

/**
 * Prices of one list (CSV): code (service), montant (in the list currency,
 * major units), debut (YYYY-MM-DD), fin (optional, excluded).
 */
export function parsePrices(
  table: CsvTable,
  minorUnit: number,
): { items: PriceImportRow[]; errors: FinanceImportError[] } {
  const header = table.header.map(fold);
  const idx = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const items: PriceImportRow[] = [];
  const errors: FinanceImportError[] = [];
  const iCode = idx('code', 'code_service');
  const iAmount = idx('montant', 'amount', 'prix');
  const iFrom = idx('debut', 'valid_from');
  const iUntil = idx('fin', 'valid_until');
  if (iCode < 0 || iAmount < 0 || iFrom < 0) {
    return { items, errors: [{ line: 1, message: 'FACT_IMPORT_COLUMNS' }] };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const code = (cells[iCode] ?? '').trim().toUpperCase();
    const amount = parseAmount(cells[iAmount] ?? '', minorUnit);
    const validFrom = (cells[iFrom] ?? '').trim();
    const until = iUntil >= 0 ? (cells[iUntil] ?? '').trim() : '';
    if (!code || amount === null || !day.test(validFrom) || (until && !day.test(until))) {
      errors.push({ line, message: 'FACT_IMPORT_VALUE' });
      continue;
    }
    if (until && until <= validFrom) {
      errors.push({ line, message: 'FACT_IMPORT_VALUE' });
      continue;
    }
    const key = `${code}|${validFrom}`;
    if (seen.has(key)) {
      errors.push({ line, message: 'FACT_IMPORT_DUPLICATE' });
      continue;
    }
    seen.add(key);
    items.push({ line, serviceCode: code, amount, validFrom, validUntil: until || null });
  }
  return { items, errors };
}
