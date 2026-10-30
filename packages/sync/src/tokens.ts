import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64ToBytes } from './signing';

/**
 * Compact JWS (EdDSA, Ed25519) for the platform tokens of docs/02-offline-sync.md
 * section 9. Signed on the server only; verified both on the server and, offline,
 * in the browser with the platform public keys (several `kid` for rotation).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export type OfflineTokenClaims = {
  typ: 'offline';
  /** User, structure and device the token unlocks offline. */
  sub: string;
  tid: string;
  did: string;
  /** Fingerprint of the permission snapshot stored on the device. */
  perm: string;
  iat: number;
  exp: number;
};

export type LicenseState = 'trial' | 'active' | 'past_due' | 'grace' | 'read_only' | 'suspended';

export type LicenseTokenClaims = {
  typ: 'license';
  tid: string;
  plan: string | null;
  modules: string[];
  limits: Record<string, number>;
  state: LicenseState;
  iat: number;
  validUntil: number;
  graceAt: number | null;
  readOnlyAt: number | null;
  suspendAt: number | null;
};

export type TokenClaims = OfflineTokenClaims | LicenseTokenClaims;

/** Public keys by key id, base64 encoded (raw 32-byte Ed25519 keys). */
export type SigningKeys = Record<string, string>;

export function permissionFingerprint(permissions: Iterable<string>): string {
  const sorted = [...new Set(permissions)].sort().join('\n');
  return toBase64Url(sha256(encoder.encode(sorted))).slice(0, 22);
}

export function signToken(claims: TokenClaims, secretKey: Uint8Array, kid: string): string {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })));
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = ed25519.sign(encoder.encode(`${header}.${payload}`), secretKey);
  return `${header}.${payload}.${toBase64Url(signature)}`;
}

/**
 * Returns the claims when the signature is valid for one of the known keys,
 * null otherwise. Expiry is checked by the caller, with its own notion of "now".
 */
export function verifyToken<T extends TokenClaims['typ']>(
  token: string,
  keys: SigningKeys,
  typ: T,
): Extract<TokenClaims, { typ: T }> | null {
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;
    const parsedHeader = JSON.parse(decoder.decode(fromBase64Url(header))) as {
      alg?: string;
      kid?: string;
    };
    if (parsedHeader.alg !== 'EdDSA' || !parsedHeader.kid) return null;
    const publicKey = keys[parsedHeader.kid];
    if (!publicKey) return null;
    const valid = ed25519.verify(
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
      base64ToBytes(publicKey),
    );
    if (!valid) return null;
    const claims = JSON.parse(decoder.decode(fromBase64Url(payload))) as TokenClaims;
    return claims.typ === typ ? (claims as Extract<TokenClaims, { typ: T }>) : null;
  } catch {
    return null;
  }
}
