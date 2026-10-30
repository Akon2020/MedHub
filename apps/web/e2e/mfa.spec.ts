import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { activateDevice, TEST_PIN, tenantCode, unlock, withServer } from './support';

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
  browser,
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
  await expect(page.getByRole('heading', { name: 'Codes de secours' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('listitem').filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ }),
  ).toHaveCount(10);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.waitForURL(/\/connexion\/activation$/);

  // Second sign-in: the password alone is no longer enough.
  await page.context().clearCookies();
  await signIn(page, 'admin');
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page.getByText('Code incorrect ou déjà utilisé.')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Code à 6 chiffres').fill(await freshCode(secret, enrolledAt));
  const verifiedAt = Date.now();
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

  // Organization: the session was opened with the second factor, so no prompt yet.
  await page.goto('/app/parametres/organisation');
  await unlock(page);
  await page.getByRole('button', { name: 'Ajouter un site' }).click();
  await page.getByLabel('Code (3 lettres)').fill('gom');
  await page.getByLabel('Nom du site').fill('Site de Goma');
  await page.getByRole('button', { name: 'Créer le site' }).click();
  await expect(page.getByText('Site de Goma')).toBeVisible({ timeout: 20_000 });

  // Twenty minutes later the proof is too old: the change asks for a code first.
  await withServer((client) =>
    client.query(
      "update session set mfa_verified_at = now() - interval '20 minutes' where user_id = (select id from user_account where username = 'admin')",
    ),
  );
  await page.getByRole('button', { name: 'Modifier GOM' }).click();
  await page.getByLabel('Nom du site').fill('Site de Goma Nord');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Confirmez votre identité' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel('Code de vérification').fill(await freshCode(secret, verifiedAt));
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByText('Site de Goma Nord')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/organization-dark.png', fullPage: true });

  // Remote wipe: another workstation is declared lost, then erases itself on its next contact.
  const other = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block' });
  const tablet = await other.newPage();
  await activateDevice(tablet, 'accueil', 'Tablette volée');
  await page.goto('/app/parametres/appareils');
  await unlock(page);
  const row = page.getByRole('listitem').filter({ hasText: 'Tablette volée' });
  await row.getByRole('button', { name: 'Déclarer perdu' }).click();
  await page.getByLabel('Motif').fill('Tablette volée pendant la garde (fictif)');
  await page.getByRole('button', { name: 'Déclarer perdu ou volé' }).click();
  await expect(row.getByText('Perdu ou volé')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/devices-dark.png', fullPage: true });

  await tablet.goto('/app');
  await tablet.waitForLoadState('networkidle');
  await tablet.getByLabel('Code PIN').fill(TEST_PIN);
  await tablet.getByRole('button', { name: 'Déverrouiller' }).click();
  await tablet.waitForURL(/\/connexion$/, { timeout: 30_000 });
  await expect(tablet.getByText(/a été retiré ou déclaré perdu/)).toBeVisible();
  expect(await tablet.evaluate(() => localStorage.getItem('medhub.identity'))).toBeNull();
  const databases = await tablet.evaluate(async () => (await indexedDB.databases()).length);
  expect(databases).toBe(0);
  await other.close();

  // A new account: temporary password shown once, replaced by the user at first sign-in.
  await page.goto('/app/parametres/utilisateurs');
  await unlock(page);
  await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
  await page.getByLabel('Identifiant', { exact: true }).fill('e2e.mbuyi');
  await page.getByLabel('Nom complet').fill('Grâce Mbuyi');
  await page.getByRole('checkbox', { name: 'Accueil', exact: true }).check();
  await page.getByRole('button', { name: "Créer l'utilisateur" }).click();
  const temporary = (
    await page.getByTestId('temporary-password').innerText({ timeout: 20_000 })
  ).trim();
  await page.screenshot({ path: 'test-results/users-dark.png', fullPage: true });

  const fresh = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block' });
  const newcomer = await fresh.newPage();
  await newcomer.goto('/connexion');
  await newcomer.waitForLoadState('networkidle');
  await newcomer.getByLabel('Code de la structure').fill(tenantCode());
  await newcomer.getByLabel('Identifiant').fill('e2e.mbuyi');
  await newcomer.getByLabel('Mot de passe').fill(temporary);
  await newcomer.getByRole('button', { name: 'Se connecter' }).click();
  await expect(
    newcomer.getByRole('heading', { name: 'Choisissez votre mot de passe' }),
  ).toBeVisible({ timeout: 20_000 });
  await newcomer.getByLabel('Nouveau mot de passe').fill('azerty2024');
  await newcomer.getByLabel('Confirmez le mot de passe').fill('azerty2024');
  await newcomer.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  await expect(newcomer.getByText(/Mot de passe refusé/)).toBeVisible({ timeout: 20_000 });
  await newcomer.getByLabel('Nouveau mot de passe').fill('la pirogue glisse sur le fleuve');
  await newcomer.getByLabel('Confirmez le mot de passe').fill('la pirogue glisse sur le fleuve');
  await newcomer.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  await newcomer.waitForURL(/\/connexion\/activation$/, { timeout: 30_000 });
  await fresh.close();

  // Disabling keeps the account, visible and audited, but ends its access.
  await page.getByRole('button', { name: "C'est noté" }).click();
  await page.getByRole('button', { name: 'Désactiver', exact: true }).click();
  await page.getByLabel('Motif').fill('Fin de contrat (fictif)');
  await page.getByRole('button', { name: 'Désactiver le compte' }).click();
  await expect(page.getByText('Désactivé', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Role editor: duplicate the front desk role, then narrow the copy.
  await page.goto('/app/parametres/roles');
  await unlock(page);
  await page.getByRole('button', { name: /^Accueil/ }).click();
  await page.getByRole('button', { name: 'Dupliquer' }).click();
  await page.getByLabel('Nom du rôle').fill('Accueil du soir');
  await page.getByLabel('Code', { exact: true }).fill('accueil_soir');
  await page.getByRole('button', { name: 'Créer le rôle' }).click();
  await expect(page.getByRole('heading', { name: 'Accueil du soir' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('checkbox', { name: 'Rendez-vous : Annuler' }).uncheck();
  await page.getByRole('combobox', { name: 'Périmètre : Patients' }).selectOption('site');
  await expect(page.getByText(/1 retirée/)).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer le rôle' }).click();
  await expect(page.getByText('Rôle enregistré.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('checkbox', { name: 'Rendez-vous : Annuler' })).not.toBeChecked();
  await page.screenshot({ path: 'test-results/roles-dark.png', fullPage: true });
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
