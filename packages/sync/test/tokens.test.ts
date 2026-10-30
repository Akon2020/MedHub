import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../src/signing';
import {
  permissionFingerprint,
  signToken,
  verifyToken,
  type OfflineTokenClaims,
} from '../src/tokens';

function keyPair() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: bytesToBase64(ed25519.getPublicKey(secretKey)) };
}

const claims: OfflineTokenClaims = {
  typ: 'offline',
  sub: 'user',
  tid: 'tenant',
  did: 'device',
  perm: permissionFingerprint(['patient:read', 'patient:create']),
  iat: 1_793_000_000,
  exp: 1_794_000_000,
};

describe('platform tokens', () => {
  it('verify with the key of their kid, including a previous key kept for rotation', () => {
    const current = keyPair();
    const previous = keyPair();
    const keys = { k2: current.publicKey, k1: previous.publicKey };
    expect(verifyToken(signToken(claims, current.secretKey, 'k2'), keys, 'offline')).toEqual(
      claims,
    );
    expect(verifyToken(signToken(claims, previous.secretKey, 'k1'), keys, 'offline')).toEqual(
      claims,
    );
  });

  it('refuse an unknown kid, a wrong key, a tampered payload or another token type', () => {
    const current = keyPair();
    const other = keyPair();
    const token = signToken(claims, current.secretKey, 'k2');
    expect(verifyToken(token, { k9: current.publicKey }, 'offline')).toBeNull();
    expect(verifyToken(token, { k2: other.publicKey }, 'offline')).toBeNull();
    const [header, , signature] = token.split('.');
    const forged = btoa(JSON.stringify({ ...claims, exp: claims.exp + 1_000_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(
      verifyToken(`${header}.${forged}.${signature}`, { k2: current.publicKey }, 'offline'),
    ).toBeNull();
    expect(verifyToken(token, { k2: current.publicKey }, 'license')).toBeNull();
    expect(verifyToken('not-a-token', { k2: current.publicKey }, 'offline')).toBeNull();
  });

  it('fingerprint permissions regardless of order and duplicates', () => {
    expect(permissionFingerprint(['b', 'a', 'a'])).toBe(permissionFingerprint(['a', 'b']));
    expect(permissionFingerprint(['a'])).not.toBe(permissionFingerprint(['a', 'b']));
  });
});
