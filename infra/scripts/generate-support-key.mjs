// Prints a support key pair (X25519). The public key goes into the server
// environment (MEDHUB_SUPPORT_PUBLIC_KEY); the private key stays on the support
// workstation only, to read the diagnostic journals sent by the devices.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('x25519');
const raw = (key, type) => key.export({ format: 'der', type }).subarray(-32).toString('base64');

process.stdout.write(
  [
    '# Server environment (.env.local or cPanel):',
    `MEDHUB_SUPPORT_PUBLIC_KEY=${raw(publicKey, 'spki')}`,
    '# Support workstation only, never on the server nor in the repository:',
    `MEDHUB_SUPPORT_PRIVATE_KEY=${raw(privateKey, 'pkcs8')}`,
    '',
  ].join('\n'),
);
