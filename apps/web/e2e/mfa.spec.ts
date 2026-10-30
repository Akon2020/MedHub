import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { TEST_PIN, tenantCode, unlock } from './support';

function seedPassword(): string {
  const value = process.env.MEDHUB_SEED_PASSWORD;
  if (!value) throw new Error('MEDHUB_SEED_PASSWORD is missing: run pnpm db:seed (see guide.md)');
  return value;
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/connexion');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Code de la structure').fill(tenantCode());
  await page.getByLabel('Identifiant').fill(username);
  await page.getByLabel('Mot de passe').fill(seedPassword());
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/** A code from the next TOTP window, so that it is never a replay of the previous one. */
async function freshCode(secret: string, after: number | null): Promise<string> {
  if (after !== null) {
    const window = Math.floor(after / 30_000);
    while (Math.floor(Date.now() / 30_000) === window) await new Promise((r) => setTimeout(r, 500));
  }
  return generate({ secret });
}

test('a privileged role enrolls its second factor at first sign-in, then must use it', async ({
  page,
}) => {
  test.setTimeout(4 * 60_000);
  await signIn(page, 'admin');

  await expect(page.getByRole('heading', { name: 'Protégez votre compte' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Configurer maintenant' }).click();
  const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).innerText()).replace(
    /\s/g,
    '',
  );
  await expect(page.getByAltText(/Code QR/)).toBeVisible();
  await page.screenshot({ path: 'test-results/mfa-enroll.png' });

  await page.getByLabel('Code à 6 chiffres').fill(await freshCode(secret, null));
  const enrolledAt = Date.now();
  await page.getByRole('button', { name: 'Activer la double authentification' }).click();
  await expect(page.getByRole('heading', { name: 'Codes de secours' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ }),
  ).toHaveCount(10);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.waitForURL(/\/connexion\/activation$/);

  // Second sign-in: the password alone is no longer enough.
  await page.context().clearCookies();
  await signIn(page, 'admin');
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page.getByText('Code incorrect ou déjà utilisé.')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(await freshCode(secret, enrolledAt));
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await page.waitForURL(/\/connexion\/activation$/);

  // Device activation, then the account page in the dark theme.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Code PIN', { exact: true }).fill(TEST_PIN);
  await page.getByLabel('Confirmer le code PIN').fill(TEST_PIN);
  await page.getByLabel('Nom du poste').fill('E2E admin');
  await page.getByRole('button', { name: 'Activer le poste' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Ouvrir MedHub' }).click();
  await unlock(page);

  await page.context().addCookies([{ name: 'medhub_theme', value: 'dark', url: page.url() }]);
  await page.goto('/app/compte');
  await unlock(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('Activée', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cet appareil')).toBeVisible();
  await page.screenshot({ path: 'test-results/account-dark.png', fullPage: true });
  await page.goto('/app');
  await unlock(page);
  await page.screenshot({ path: 'test-results/dashboard-dark.png', fullPage: true });
});

test('content security policy carries a fresh nonce on every document', async ({ request }) => {
  const first = await request.get('/connexion');
  const second = await request.get('/connexion');
  const policy = first.headers()['content-security-policy'] ?? '';
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("'unsafe-eval'");
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(second.headers()['content-security-policy']).not.toContain(nonce as string);
  expect(await first.text()).toContain(`nonce="${nonce as string}"`);
});
