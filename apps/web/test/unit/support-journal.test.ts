import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { sealForSupport } from '@medhub/sync';

it('the support script opens what a device sealed', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const raw = (k: typeof privateKey, type: 'spki' | 'pkcs8') =>
    k.export({ format: 'der', type }).subarray(-32).toString('base64');
  const envelope = await sealForSupport('{"pending":2}', raw(publicKey, 'spki'));
  const file = join(mkdtempSync(join(tmpdir(), 'diag-')), 'x.medhub-diag');
  writeFileSync(file, JSON.stringify(envelope));
  const out = execFileSync(
    'node',
    [resolve(__dirname, '../../../../infra/scripts/decrypt-diagnostic.mjs'), file],
    {
      env: { ...process.env, MEDHUB_SUPPORT_PRIVATE_KEY: raw(privateKey, 'pkcs8') },
    },
  ).toString();
  expect(JSON.parse(out)).toEqual({ pending: 2 });
});
