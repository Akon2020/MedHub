import { generateKeyPairSync } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end scenarios (docs/10-tests-qualite.md). A production build with the
 * E2E test hook enabled is made in .next-e2e and served on port 3100 (the dev
 * server recompiles under load and makes the bench flaky). Service workers are
 * blocked so that offline behaviour comes from the app, not from a stale cache.
 * Run `pnpm exec playwright install chromium` once before the first run.
 */
const PORT = 3100;

// A throwaway support key per run: the test server seals diagnostic journals with
// the public half, the scenario opens the exported file with the private half.
if (!process.env.E2E_SUPPORT_PRIVATE_KEY) {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  process.env.E2E_SUPPORT_PRIVATE_KEY = privateKey
    .export({ format: 'der', type: 'pkcs8' })
    .subarray(-32)
    .toString('base64');
  process.env.E2E_SUPPORT_PUBLIC_KEY = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');
}
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure', locale: 'fr-FR', serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] }, testMatch: /public\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        // A production build takes 3 to 6 minutes on the development machine.
        timeout: 600_000,
        env: {
          NEXT_PUBLIC_MEDHUB_E2E: '1',
          NEXT_DIST_DIR: '.next-e2e',
          MEDHUB_SUPPORT_PUBLIC_KEY: process.env.E2E_SUPPORT_PUBLIC_KEY ?? '',
        },
      },
});
