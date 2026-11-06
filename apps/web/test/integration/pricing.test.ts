import { resolve } from 'node:path';
import { createDb, schema, withSystem, withTenant, type DbHandle } from '@medhub/db';
import { resolvePrice } from '@medhub/domain';
import { uuidv7 } from '@medhub/shared';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({
  path: [resolve(__dirname, '../../../../.env.local'), resolve(__dirname, '../../../../.env')],
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
const tenantId = uuidv7();
const userId = uuidv7();
const PERMISSIONS = ['price:read', 'price:manage'];

let handle: DbHandle;
type Pricing = typeof import('@/server/modules/fact/pricing');
let pricing: Pricing;

const ctx = () => ({
  tenantId,
  userId,
  sessionId: uuidv7(),
  deviceId: null,
  mfaVerifiedAt: new Date(),
});
const client = { ip: null };
const tenantTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(handle.db, { tenantId, userId: null }, fn);

describe.skipIf(!url)('pricing against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MEDHUB_FIELD_MASTER_KEY ??= Buffer.alloc(32, 19).toString('base64');
    process.env.MEDHUB_SESSION_SECRET ??= 'integration-test-session-secret-000000000';
    pricing = await import('@/server/modules/fact/pricing');
    handle = createDb(url as string, 4);
    await withSystem(handle.db, (tx) =>
      tx.insert(schema.tenant).values({
        id: tenantId,
        code: `TST-PRX-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        legalName: 'Structure de test tarifs',
        displayName: 'Structure de test tarifs',
        type: 'clinic',
        status: 'active',
      }),
    );
    await tenantTx(async (tx) => {
      const roleId = uuidv7();
      await tx.insert(schema.role).values({ id: roleId, tenantId, code: 'fin', name: 'Finances' });
      await tx
        .insert(schema.rolePermission)
        .values(PERMISSIONS.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
      await tx.insert(schema.userAccount).values({
        id: userId,
        tenantId,
        username: 'fin',
        displayName: 'Finances',
        passwordHash: 'x',
      });
      await tx.insert(schema.userRole).values({ id: uuidv7(), tenantId, userId, roleId });
    });
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it('imports services and dated prices, keeps the history and resolves the price of a day', async () => {
    const services =
      'code;libelle;categorie\nCONS;Consultation générale;consultation\nGE;Goutte épaisse;laboratoire';
    expect(
      await pricing.importServiceItems(ctx(), { csv: services, apply: false }, client),
    ).toEqual({
      items: 2,
      errors: [],
    });
    await pricing.importServiceItems(ctx(), { csv: services, apply: true }, client);
    const { id: listId } = await pricing.savePriceList(
      ctx(),
      { code: 'PUB', name: 'Public', kind: 'public', currency: 'USD', isActive: true },
      client,
    );
    await expect(
      pricing.savePriceList(
        ctx(),
        { code: 'PUB', name: 'Doublon', kind: 'public', currency: 'USD', isActive: true },
        client,
      ),
    ).rejects.toMatchObject({ code: 'FACT_CODE_TAKEN' });

    const checked = await pricing.importPrices(
      ctx(),
      {
        priceListId: listId,
        csv: 'code;montant;debut\nCONS;10;2026-01-01\nXX;5;2026-01-01',
        apply: false,
      },
      client,
    );
    expect(checked).toEqual({
      items: 1,
      errors: [{ line: 3, message: 'FACT_IMPORT_UNKNOWN_SERVICE' }],
    });
    await pricing.importPrices(
      ctx(),
      {
        priceListId: listId,
        csv: 'code;montant;debut\nCONS;10;2026-01-01\nGE;3,50;2026-01-01',
        apply: true,
      },
      client,
    );
    await pricing.importPrices(
      ctx(),
      { priceListId: listId, csv: 'code;montant;debut\nCONS;12;2026-07-01', apply: true },
      client,
    );

    const rows = await tenantTx((tx) =>
      tx.select().from(schema.price).where(eq(schema.price.priceListId, listId)),
    );
    expect(rows.map((r) => [r.amount, r.validFrom, r.validUntil]).sort()).toEqual([
      [1000, '2026-01-01', '2026-07-01'],
      [1200, '2026-07-01', null],
      [350, '2026-01-01', null],
    ]);

    const catalog = await tenantTx((tx) => pricing.financeCatalog(tx, '2026-11-06'));
    const consult = catalog.serviceItems.find((s) => s.code === 'CONS')!;
    expect(
      resolvePrice(
        { serviceItemId: consult.id, day: '2026-03-01' },
        catalog.priceLists,
        catalog.prices,
      ),
    ).toBeNull();
    expect(
      resolvePrice(
        { serviceItemId: consult.id, day: '2026-11-06' },
        catalog.priceLists,
        catalog.prices,
      )?.unitPrice,
    ).toEqual({ amount: 1200, currency: 'USD' });
  });

  it('records rates without ever changing them, applies the default cash rounding', async () => {
    await pricing.setExchangeRate(
      ctx(),
      { from: 'USD', to: 'CDF', rate: '2850', validFrom: '2026-11-05' },
      client,
    );
    await pricing.setExchangeRate(
      ctx(),
      { from: 'USD', to: 'CDF', rate: '2865.5', validFrom: '2026-11-05' },
      client,
    );
    await expect(
      pricing.setExchangeRate(
        ctx(),
        { from: 'USD', to: 'USD', rate: '1', validFrom: '2026-11-05' },
        client,
      ),
    ).rejects.toMatchObject({ code: 'FACT_RATE_INVALID' });
    await expect(
      tenantTx((tx) => tx.update(schema.exchangeRate).set({ rate: '1' })),
    ).rejects.toThrow();

    const catalog = await tenantTx((tx) => pricing.financeCatalog(tx, '2026-11-06'));
    expect(catalog.exchangeRates).toEqual([
      { from: 'USD', to: 'CDF', rate: '2865.5', validFrom: '2026-11-05' },
    ]);
    expect(catalog.currencies).toEqual([
      { currency: 'CDF', cashRoundingStep: 5000, isAccepted: true },
      { currency: 'USD', cashRoundingStep: 0, isAccepted: true },
    ]);
    await pricing.saveCurrencySetting(
      ctx(),
      { currency: 'CDF', cashRoundingStep: 10000, isAccepted: true },
      client,
    );
    expect((await tenantTx((tx) => pricing.currencySettings(tx)))[0]?.cashRoundingStep).toBe(10000);
  });
});
