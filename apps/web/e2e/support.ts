import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { config } from 'dotenv';
import pg from 'pg';

config({
  path: [
    resolve(import.meta.dirname, '../../../.env.local'),
    resolve(import.meta.dirname, '../../../.env'),
  ],
  quiet: true,
});

/** Structure created for this run by global-setup.ts, the demo one otherwise. */
export function tenantCode(): string {
  return process.env.MEDHUB_E2E_TENANT ?? 'HOP-DEM-0001';
}
export const TEST_PIN = '135792';

function seedPassword(): string {
  const value = process.env.MEDHUB_SEED_PASSWORD;
  if (!value) throw new Error('MEDHUB_SEED_PASSWORD is missing: run pnpm db:seed (see guide.md)');
  return value;
}

/** Real sign-in and device activation through the screens, then PIN unlock. */
export async function activateDevice(
  page: Page,
  username: string,
  deviceName = `E2E ${username}`,
): Promise<void> {
  await page.goto('/connexion');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Code de la structure').fill(tenantCode());
  await page.getByLabel('Identifiant').fill(username);
  await page.getByLabel('Mot de passe').fill(seedPassword());
  // A sign-in once went unanswered for 20 s (not reproduced in isolation, see
  // docs/avancement.md). Like a user, retry once after "server unreachable".
  for (let attempt = 1; ; attempt += 1) {
    await page.getByRole('button', { name: 'Se connecter' }).click();
    const outcome = await Promise.race([
      page.waitForURL(/\/connexion\/activation$/, { timeout: 60_000 }).then(() => 'ok' as const),
      page
        .getByText('Le serveur est injoignable', { exact: false })
        .waitFor({ timeout: 60_000 })
        .then(() => 'unreachable' as const),
    ]);
    if (outcome === 'ok') break;
    if (attempt >= 2) throw new Error('sign-in failed twice: server unreachable');
    console.warn(`[e2e] sign-in of ${username} unanswered, retrying once`);
  }
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Code PIN', { exact: true }).fill(TEST_PIN);
  await page.getByLabel('Confirmer le code PIN').fill(TEST_PIN);
  await page.getByLabel('Nom du poste').fill(deviceName);
  await page.getByRole('button', { name: 'Activer le poste' }).click();
  await expect(page.getByText('Code de récupération', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Ouvrir MedHub' }).click();
  await unlock(page);
}

export async function unlock(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Code PIN').fill(TEST_PIN);
  await page.getByRole('button', { name: 'Déverrouiller' }).click();
  await page.waitForFunction(() => window.__medhubTest !== undefined, undefined, {
    timeout: 30_000,
  });
}

/** Direct read of the server database, inside the structure context so that RLS applies. */
export async function withServer<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is missing');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>('select id from tenant where code = $1', [
      tenantCode(),
    ]);
    const tenantId = rows[0]?.id;
    if (!tenantId) throw new Error(`structure ${tenantCode()} not found: run pnpm db:seed`);
    await client.query('begin');
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.scope', 'tenant', true)",
      [tenantId],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } finally {
    await client.end();
  }
}
