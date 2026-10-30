/**
 * Local encryption (docs/02-offline-sync.md section 3).
 *
 * A random 32-byte master secret is generated at device activation. It is
 * wrapped twice: by a key derived from the PIN (PBKDF2-SHA-256) and by a key
 * derived from the one-time recovery code. Once unwrapped, it only lives long
 * enough to derive two non-extractible keys: the AES-GCM data key and the HMAC
 * key of the hashed search index.
 */
export const PBKDF2_ITERATIONS = 600_000;
const RECOVERY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type WrappedSecret = {
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
};

export type LocalKeys = {
  dataKey: CryptoKey;
  indexKey: CryptoKey;
};

export type Ciphertext = { iv: string; ct: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function generateMasterSecret(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(24);
  let code = '';
  for (const b of bytes) code += RECOVERY_ALPHABET[b % 32];
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

async function kekFromSecret(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapSecret(
  master: Uint8Array<ArrayBuffer>,
  secret: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<WrappedSecret> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kek = await kekFromSecret(secret, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, master);
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), iterations };
}

/** Throws `LOCAL_UNLOCK_FAILED` on a wrong PIN or recovery code. */
export async function unwrapSecret(
  wrapped: WrappedSecret,
  secret: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await kekFromSecret(secret, fromB64(wrapped.salt), wrapped.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(wrapped.iv) },
      kek,
      fromB64(wrapped.ct),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error('LOCAL_UNLOCK_FAILED');
  }
}

export async function deriveLocalKeys(master: Uint8Array<ArrayBuffer>): Promise<LocalKeys> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
  const params = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(32),
    info: encoder.encode(info),
  });
  const dataKey = await crypto.subtle.deriveKey(
    params('medhub-local-data-v1'),
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const indexKey = await crypto.subtle.deriveKey(
    params('medhub-local-index-v1'),
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
  master.fill(0);
  return { dataKey, indexKey };
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Ciphertext> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJson<T>(key: CryptoKey, value: Ciphertext): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(value.iv) },
    key,
    fromB64(value.ct),
  );
  return JSON.parse(decoder.decode(plain)) as T;
}

export async function hmacToken(key: CryptoKey, value: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toB64(new Uint8Array(sig).slice(0, 16));
}

export function bytesToB64(bytes: Uint8Array): string {
  return toB64(bytes);
}

export function b64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return fromB64(value);
}
