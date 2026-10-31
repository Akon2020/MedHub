// Opens a diagnostic journal exported by a device (Diagnostic, "Exporter le
// journal"). Usage: MEDHUB_SUPPORT_PRIVATE_KEY=... pnpm support:decrypt file.medhub-diag
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const secret = process.env.MEDHUB_SUPPORT_PRIVATE_KEY;
if (!file || !secret) {
  console.error(
    'Usage : MEDHUB_SUPPORT_PRIVATE_KEY=... pnpm support:decrypt <fichier.medhub-diag>',
  );
  process.exit(1);
}

const envelope = JSON.parse(readFileSync(file, 'utf8'));
if (envelope.v !== 1 || envelope.alg !== 'X25519-HKDF-A256GCM') {
  console.error('Format de fichier inconnu.');
  process.exit(1);
}
// Raw 32-byte X25519 keys wrapped in their standard DER envelopes (RFC 8410).
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const epk = Buffer.from(envelope.epk, 'base64');
const privateKey = createPrivateKey({
  key: Buffer.concat([PKCS8_PREFIX, Buffer.from(secret, 'base64')]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey({
  key: Buffer.concat([SPKI_PREFIX, epk]),
  format: 'der',
  type: 'spki',
});
const shared = diffieHellman({ privateKey, publicKey });
const key = Buffer.from(
  hkdfSync('sha256', shared, epk, Buffer.from('medhub-support-envelope-v1'), 32),
);
const data = Buffer.from(envelope.ct, 'base64');
const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
decipher.setAuthTag(data.subarray(data.length - 16));
const plain = Buffer.concat([
  decipher.update(data.subarray(0, data.length - 16)),
  decipher.final(),
]);
process.stdout.write(`${JSON.stringify(JSON.parse(plain.toString('utf8')), null, 2)}\n`);
