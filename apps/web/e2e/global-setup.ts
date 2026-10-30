import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Each run gets its own fictitious structure: new devices download the whole
 * structure, so reusing the demo one would make every run slower than the last.
 */
export default function globalSetup(): void {
  const code = `TST-BNC-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  execFileSync(
    'pnpm',
    ['--filter', '@medhub/db', 'exec', 'tsx', 'scripts/seed.ts', '--tenant', code],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  process.env.MEDHUB_E2E_TENANT = code;
}
