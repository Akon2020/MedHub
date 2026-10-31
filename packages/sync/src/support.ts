import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64ToBytes, bytesToBase64 } from './signing';

/**
 * Files a device hands to support (diagnostic journal). Sealed for the support
 * public key with X25519, HKDF-SHA256 and AES-256-GCM: anyone may carry the
 * file, only support can read it.
 */
export type SupportEnvelope = {
  v: 1;
  alg: 'X25519-HKDF-A256GCM';
  epk: string;
  iv: string;
  ct: string;
};

const INFO = new TextEncoder().encode('medhub-support-envelope-v1');

/** WebCrypto wants buffers backed by a plain ArrayBuffer. */
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

function aesKey(shared: Uint8Array, epk: Uint8Array): Promise<CryptoKey> {
  const raw = hkdf(sha256, shared, epk, INFO, 32);
  return crypto.subtle.importKey('raw', owned(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function generateSupportKeyPair(): { publicKey: string; privateKey: string } {
  const secret = x25519.utils.randomSecretKey();
  return {
    privateKey: bytesToBase64(secret),
    publicKey: bytesToBase64(x25519.getPublicKey(secret)),
  };
}

export async function sealForSupport(
  plaintext: string,
  supportPublicKey: string,
): Promise<SupportEnvelope> {
  const ephemeral = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(ephemeral);
  const key = await aesKey(x25519.getSharedSecret(ephemeral, base64ToBytes(supportPublicKey)), epk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  return {
    v: 1,
    alg: 'X25519-HKDF-A256GCM',
    epk: bytesToBase64(epk),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
}

export async function openForSupport(
  envelope: SupportEnvelope,
  supportPrivateKey: string,
): Promise<string> {
  const epk = base64ToBytes(envelope.epk);
  const key = await aesKey(x25519.getSharedSecret(base64ToBytes(supportPrivateKey), epk), epk);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: owned(base64ToBytes(envelope.iv)) },
    key,
    owned(base64ToBytes(envelope.ct)),
  );
  return new TextDecoder().decode(plain);
}
