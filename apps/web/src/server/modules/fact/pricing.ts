import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  DEFAULT_CASH_ROUNDING,
  parsePrices,
  parseServiceItems,
  type ExchangeRate,
  type FinanceImportError,
  type Price,
  type PriceList,
  type PriceListInput,
  type ServiceItem,
  type ServiceItemInput,
} from '@medhub/domain';
import { AppError, DEFAULT_CURRENCIES, parseCsv, uuidv7 } from '@medhub/shared';
import { and, asc, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

type Client = { ip: string | null };

export type CurrencySetting = { currency: string; cashRoundingStep: number; isAccepted: boolean };

/** Accepted currencies with their cash rounding; USD and CDF by default (S10 decision). */
export async function currencySettings(tx: Tx): Promise<CurrencySetting[]> {
  const rows = await tx.select().from(schema.tenantCurrency);
  const codes = new Set(['USD', 'CDF', ...rows.map((r) => r.currency)]);
  return [...codes].sort().map((currency) => {
    const row = rows.find((r) => r.currency === currency);
    return {
      currency,
      cashRoundingStep: row?.cashRoundingStep ?? DEFAULT_CASH_ROUNDING[currency] ?? 0,
      isAccepted: row?.isAccepted ?? true,
    };
  });
}

/**
 * What a workstation needs to price and cash offline: the nomenclature, the
 * active lists, prices still in force or to come, recent exchange rates and
 * the currency settings.
 */
export async function financeCatalog(tx: Tx, today: string) {
  const serviceItems: ServiceItem[] = (
    await tx.select().from(schema.serviceItem).orderBy(asc(schema.serviceItem.code))
  ).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category as ServiceItem['category'],
    isActive: r.isActive,
  }));
  const priceLists: PriceList[] = (await tx.select().from(schema.priceList)).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind as PriceList['kind'],
    currency: r.currency,
    isActive: r.isActive,
  }));
  const prices: Price[] = (
    await tx
      .select()
      .from(schema.price)
      .where(or(isNull(schema.price.validUntil), gte(schema.price.validUntil, today)))
  ).map((r) => ({
    priceListId: r.priceListId,
    serviceItemId: r.serviceItemId,
    amount: r.amount,
    currency: r.currency,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
  }));
  const exchangeRates: ExchangeRate[] = (
    await tx
      .select()
      .from(schema.exchangeRate)
      .orderBy(desc(schema.exchangeRate.validFrom), desc(schema.exchangeRate.createdAt))
      .limit(60)
  ).map((r) => ({
    from: r.fromCurrency,
    to: r.toCurrency,
    rate: normalizeRate(r.rate),
    validFrom: r.validFrom,
  }));
  return {
    serviceItems,
    priceLists,
    prices,
    exchangeRates: latestPerDay(exchangeRates),
    currencies: await currencySettings(tx),
  };
}

/** One rate per pair and day: the last one entered wins. */
function latestPerDay(rates: ExchangeRate[]): ExchangeRate[] {
  const seen = new Set<string>();
  return rates.filter((r) => {
    const key = `${r.from}|${r.to}|${r.validFrom}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRate(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export async function financeOverview(ctx: RequestContext) {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'price:read');
    const today = new Date().toISOString().slice(0, 10);
    const allPrices = await tx.select().from(schema.price).orderBy(desc(schema.price.validFrom));
    return {
      ...(await financeCatalog(tx, today)),
      priceHistory: allPrices.map((r) => ({
        id: r.id,
        priceListId: r.priceListId,
        serviceItemId: r.serviceItemId,
        amount: r.amount,
        currency: r.currency,
        validFrom: r.validFrom,
        validUntil: r.validUntil,
      })),
      canManage: permissions.has('price:manage'),
    };
  });
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

async function manage(ctx: RequestContext, fn: (tx: Tx) => Promise<unknown>) {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'price:manage');
    await requireRecentStepUp(tx, ctx);
    return fn(tx);
  });
}

const audit = (
  tx: Tx,
  ctx: RequestContext,
  client: Client,
  entity: string,
  entityId: string | null,
  diff: Record<string, unknown>,
) =>
  appendAudit(tx, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    ip: client.ip,
    action: 'update',
    entity,
    entityId,
    diff,
  });

export async function saveServiceItem(
  ctx: RequestContext,
  input: ServiceItemInput,
  client: Client,
): Promise<{ id: string }> {
  try {
    return (await manage(ctx, async (tx) => {
      const values = {
        code: input.code,
        name: input.name,
        category: input.category,
        isActive: input.isActive,
      };
      let id = input.id ?? null;
      if (id) {
        const [before] = await tx
          .select()
          .from(schema.serviceItem)
          .where(eq(schema.serviceItem.id, id));
        if (!before) throw new AppError('NOT_FOUND', 404);
        // The code of a service never changes: invoice lines refer to it.
        await tx
          .update(schema.serviceItem)
          .set({
            name: values.name,
            category: values.category,
            isActive: values.isActive,
            updatedAt: new Date(),
          })
          .where(eq(schema.serviceItem.id, id));
      } else {
        id = uuidv7();
        await tx.insert(schema.serviceItem).values({ id, tenantId: ctx.tenantId, ...values });
      }
      await audit(tx, ctx, client, 'service_item', id, values);
      return { id };
    })) as { id: string };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('FACT_CODE_TAKEN', 409);
    throw error;
  }
}

export async function savePriceList(
  ctx: RequestContext,
  input: PriceListInput,
  client: Client,
): Promise<{ id: string }> {
  try {
    return (await manage(ctx, async (tx) => {
      let id = input.id ?? null;
      if (id) {
        // Code and currency are fixed once prices exist; name, kind and state may change.
        await tx
          .update(schema.priceList)
          .set({
            name: input.name,
            kind: input.kind,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(schema.priceList.id, id));
      } else {
        id = uuidv7();
        await tx.insert(schema.priceList).values({
          id,
          tenantId: ctx.tenantId,
          code: input.code,
          name: input.name,
          kind: input.kind,
          currency: input.currency,
          isActive: input.isActive,
        });
      }
      await audit(tx, ctx, client, 'price_list', id, { ...input, id });
      return { id };
    })) as { id: string };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('FACT_CODE_TAKEN', 409);
    throw error;
  }
}

type ImportResult = { items: number; errors: FinanceImportError[] };

export async function importServiceItems(
  ctx: RequestContext,
  input: { csv: string; apply: boolean },
  client: Client,
): Promise<ImportResult> {
  const { items, errors } = parseServiceItems(parseCsv(input.csv));
  if (!input.apply) {
    await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) =>
      requirePermission(await loadPermissions(tx, ctx.userId), 'price:manage'),
    );
    return { items: items.length, errors };
  }
  if (errors.length > 0) throw new AppError('VALIDATION_FAILED', 400, { errors: errors.length });
  await manage(ctx, async (tx) => {
    for (const item of items) {
      await tx
        .insert(schema.serviceItem)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, ...item })
        .onConflictDoUpdate({
          target: [schema.serviceItem.tenantId, schema.serviceItem.code],
          set: { name: item.name, category: item.category, isActive: true, updatedAt: new Date() },
        });
    }
    await audit(tx, ctx, client, 'service_item', null, { imported: items.length });
  });
  return { items: items.length, errors };
}

/**
 * Prices of one list (CSV). A price for a day already present in the list is
 * replaced; otherwise a new dated price is added and the one it follows is
 * closed on that day, so the history stays readable.
 */
export async function importPrices(
  ctx: RequestContext,
  input: { priceListId: string; csv: string; apply: boolean },
  client: Client,
): Promise<ImportResult> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'price:manage');
    const [list] = await tx
      .select()
      .from(schema.priceList)
      .where(eq(schema.priceList.id, input.priceListId));
    if (!list) throw new AppError('NOT_FOUND', 404);
    const minorUnit = DEFAULT_CURRENCIES[list.currency]?.minorUnit ?? 2;
    const parsed = parsePrices(parseCsv(input.csv), minorUnit);
    const services = await tx.select().from(schema.serviceItem);
    const errors = [...parsed.errors];
    const rows = parsed.items.flatMap((item) => {
      const service = services.find((s) => s.code === item.serviceCode);
      if (!service) {
        errors.push({ line: item.line, message: 'FACT_IMPORT_UNKNOWN_SERVICE' });
        return [];
      }
      return [{ ...item, serviceItemId: service.id }];
    });
    errors.sort((a, b) => a.line - b.line);
    if (!input.apply) return { items: rows.length, errors };
    await requireRecentStepUp(tx, ctx);
    if (errors.length > 0) throw new AppError('VALIDATION_FAILED', 400, { errors: errors.length });
    for (const row of rows) {
      const [previous] = await tx
        .select()
        .from(schema.price)
        .where(
          and(
            eq(schema.price.priceListId, list.id),
            eq(schema.price.serviceItemId, row.serviceItemId),
            isNull(schema.price.validUntil),
          ),
        )
        .orderBy(desc(schema.price.validFrom))
        .limit(1);
      if (previous && previous.validFrom < row.validFrom) {
        await tx
          .update(schema.price)
          .set({ validUntil: row.validFrom, updatedAt: new Date() })
          .where(eq(schema.price.id, previous.id));
      }
      await tx
        .insert(schema.price)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          priceListId: list.id,
          serviceItemId: row.serviceItemId,
          amount: row.amount,
          currency: list.currency,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
        })
        .onConflictDoUpdate({
          target: [
            schema.price.tenantId,
            schema.price.priceListId,
            schema.price.serviceItemId,
            schema.price.validFrom,
          ],
          set: { amount: row.amount, validUntil: row.validUntil, updatedAt: new Date() },
        });
    }
    await audit(tx, ctx, client, 'price', null, { priceListId: list.id, imported: rows.length });
    return { items: rows.length, errors };
  });
}

/** Rate of the day entered by an authorised person (online only, docs/modules/fact.md). */
export async function setExchangeRate(
  ctx: RequestContext,
  input: { from: string; to: string; rate: string; validFrom: string },
  client: Client,
): Promise<{ id: string }> {
  if (input.from === input.to) throw new AppError('FACT_RATE_INVALID', 400);
  return (await manage(ctx, async (tx) => {
    const id = uuidv7();
    await tx.insert(schema.exchangeRate).values({
      id,
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      fromCurrency: input.from,
      toCurrency: input.to,
      rate: input.rate,
      validFrom: input.validFrom,
    });
    await audit(tx, ctx, client, 'exchange_rate', id, input);
    return { id };
  })) as { id: string };
}

export async function saveCurrencySetting(
  ctx: RequestContext,
  input: CurrencySetting,
  client: Client,
): Promise<void> {
  await manage(ctx, async (tx) => {
    await tx
      .insert(schema.tenantCurrency)
      .values({ tenantId: ctx.tenantId, ...input })
      .onConflictDoUpdate({
        target: [schema.tenantCurrency.tenantId, schema.tenantCurrency.currency],
        set: {
          cashRoundingStep: input.cashRoundingStep,
          isAccepted: input.isAccepted,
          updatedAt: new Date(),
        },
      });
    await audit(tx, ctx, client, 'tenant_currency', null, { ...input });
  });
}
