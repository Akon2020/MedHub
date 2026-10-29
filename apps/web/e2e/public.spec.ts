import { expect, test } from '@playwright/test';

test('public page presents MedHub and leads to sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await page
    .getByRole('link', { name: /accéder à ma structure/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/connexion$/);
});

test('sign-in explains that a first sign-in needs the network', async ({ page, context }) => {
  await page.goto('/connexion');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('button', { name: /se connecter/i })).toBeDisabled();
  await context.setOffline(false);
});
