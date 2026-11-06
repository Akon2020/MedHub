import { expect, test, type Browser, type Page } from '@playwright/test';
import { activateDevice, unlock, withServer } from './support';

/**
 * Scenario P1, cash desk (docs/08-parcours-acceptation.md steps 2, 9 and 10,
 * without conventions which come with S11): the visit opening bills the
 * consultation offline, the cashier takes the payment of a USD invoice in CDF
 * cash offline at the rate of the day, rounded to 50 CDF with change, then
 * closes the session; everything reaches the server without any rejection.
 */
async function open(browser: Browser, username: string) {
  const context = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await context.newPage();
  await activateDevice(page, username);
  return { context, page };
}

const synced = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();

const localDay = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

test('scenario P1 cash desk: visit billed offline, paid in CDF offline, session closed', async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const startedAt = new Date();

  // Fictitious price, rate and billing rule of the test structure.
  await withServer(async (client) => {
    const tenant = "current_setting('app.tenant_id')::uuid";
    await client.query(
      `insert into price (id, tenant_id, price_list_id, service_item_id, amount, currency, valid_from)
       select gen_random_uuid(), ${tenant}, l.id, s.id, 1200, 'USD', '2026-01-01'
         from price_list l, service_item s
        where l.code = 'PUB' and s.code = 'CONS-GEN'
       on conflict do nothing`,
    );
    await client.query(
      `insert into billing_rule (id, tenant_id, service_item_id)
       select gen_random_uuid(), ${tenant}, s.id from service_item s where s.code = 'CONS-GEN'
        and not exists (select 1 from billing_rule where is_active)`,
    );
    await client.query(
      `insert into exchange_rate (id, tenant_id, from_currency, to_currency, rate, valid_from)
       values (gen_random_uuid(), ${tenant}, 'USD', 'CDF', '2865.5', $1)`,
      [localDay()],
    );
  });

  // Reception: the visit opened offline bills the consultation.
  const desk = await open(browser, 'accueil');
  await desk.page.goto('/app/patients?new=1');
  await unlock(desk.page);
  await desk.page.getByLabel('Nom', { exact: true }).fill('Kapinga');
  await desk.page.getByLabel('Prénom').fill('Sylvie');
  await desk.page.getByLabel('ou âge estimé (ans)').fill('29');
  await desk.page.getByRole('button', { name: 'Enregistrer le patient' }).click();
  await desk.page.waitForURL(/\/app\/patients\/fiche/, { timeout: 20_000 });
  const patientId = new URL(desk.page.url()).searchParams.get('id') ?? '';
  await synced(desk.page);
  await desk.context.setOffline(true);
  await desk.page.getByLabel('File', { exact: true }).selectOption({ label: 'Accueil · Accueil' });
  await desk.page.getByRole('button', { name: 'Créer la visite et le ticket' }).click();
  await expect(desk.page.getByText(/^A-[A-Z0-9]+-\d{3}$/)).toBeVisible({ timeout: 20_000 });
  await desk.context.setOffline(false);
  await synced(desk.page);
  await desk.context.close();

  // Cash desk: session opened online, payment taken offline.
  const cashier = await open(browser, 'caisse');
  await synced(cashier.page);
  await cashier.page.goto(`/app/caisse?patient=${patientId}`);
  await unlock(cashier.page);
  await expect(cashier.page.getByText('Consultation générale')).toBeVisible({ timeout: 20_000 });
  await cashier.page.getByLabel('Fonds de caisse (CDF)').fill('0');
  await cashier.page.getByLabel('Fonds de caisse (USD)').fill('0');
  await cashier.page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(cashier.page.getByText('Caisse ouverte')).toBeVisible({ timeout: 20_000 });

  await cashier.context.setOffline(true);
  await cashier.page.getByLabel('Devise', { exact: true }).selectOption('CDF');
  await expect(cashier.page.getByText(/Taux du/)).toBeVisible();
  await cashier.page.getByLabel('Montant reçu (CDF)').fill('35000');
  await expect(cashier.page.getByText(/Monnaie à rendre/)).toBeVisible();
  // The PDF engine is fetched on first print; without a service worker in this
  // bench it cannot load offline, so the receipt is printed again once online.
  await cashier.page.getByRole('button', { name: 'Encaisser et imprimer le reçu' }).click();
  await expect(cashier.page.getByText('Payée', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Closing: the cash counted matches what the session expects.
  await cashier.page.getByRole('button', { name: 'Clôturer la caisse' }).click();
  await cashier.page.getByLabel('Espèces comptées (CDF)').fill('34400');
  await cashier.page.getByLabel('Espèces comptées (USD)').fill('0');
  await cashier.page.getByRole('button', { name: 'Clôturer définitivement' }).click();
  await expect(cashier.page.getByText('Caisse fermée')).toBeVisible({ timeout: 20_000 });
  await cashier.context.setOffline(false);
  await synced(cashier.page);
  const download = cashier.page.waitForEvent('download');
  await cashier.page.getByRole('button', { name: 'Reçu' }).click();
  expect((await download).suggestedFilename()).toMatch(/^recu-REC-/);

  const server = await withServer(async (client) => {
    const lines = await client.query<{ label: string; unit_price: string }>(
      'select l.label, l.unit_price from invoice_line l join invoice i on i.id = l.invoice_id where i.patient_id = $1',
      [patientId],
    );
    const payments = await client.query<{
      amount: string;
      currency: string;
      amount_in_invoice_currency: string;
      rounding_adjustment: string;
      change: string;
      cash_session_id: string;
    }>(
      'select amount, currency, amount_in_invoice_currency, rounding_adjustment, change, cash_session_id from payment where patient_id = $1',
      [patientId],
    );
    const sessionId = payments.rows[0]?.cash_session_id ?? null;
    const sessions = await client.query<{
      status: string;
      server_expected: Record<string, number>;
    }>('select status, server_expected from cash_session where id = $1', [sessionId]);
    const rejected = await client.query<{ n: string }>(
      "select count(*)::text as n from op_log where status = 'rejected' and received_at >= $1 and (entity_id = $2 or payload->>'patientId' = $2::text or entity_id = $3)",
      [startedAt, patientId, sessionId],
    );
    return {
      lines: lines.rows.map((r) => [r.label, Number(r.unit_price)]),
      payment: payments.rows[0],
      session: sessions.rows[0],
      rejected: Number(rejected.rows[0]?.n ?? 0),
    };
  });
  expect(server.lines).toEqual([['Consultation générale', 1200]]);
  expect(server.payment).toMatchObject({
    amount: '3440000',
    currency: 'CDF',
    amount_in_invoice_currency: '1200',
    rounding_adjustment: '1400',
    change: '60000',
  });
  expect(server.session).toMatchObject({
    status: 'closed',
    server_expected: { CDF: 3440000, USD: 0 },
  });
  expect(server.rejected).toBe(0);
  await cashier.context.close();
});
