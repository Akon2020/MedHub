// Prints fresh secrets in .env format. Run once per environment; never commit the output.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const b64 = (n) => randomBytes(n).toString('base64');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const rawPrivate = privateKey
  .export({ format: 'der', type: 'pkcs8' })
  .subarray(-32)
  .toString('base64');
const rawPublic = publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('base64');
const kid = `k${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

const lines = [
  `MEDHUB_SESSION_SECRET=${b64(48)}`,
  `MEDHUB_FIELD_MASTER_KEY=${b64(32)}`,
  `MEDHUB_FILE_MASTER_KEY=${b64(32)}`,
  `MEDHUB_BACKUP_ENCRYPTION_KEY=${b64(32)}`,
  `MEDHUB_SIGNING_KID=${kid}`,
  `MEDHUB_SIGNING_PRIVATE_KEY=${rawPrivate}`,
  `MEDHUB_SIGNING_PUBLIC_KEY=${rawPublic}`,
];
process.stdout.write(`${lines.join('\n')}\n`);
