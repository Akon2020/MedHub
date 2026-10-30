import { generate } from 'otplib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkTotp,
  hashRecoveryCode,
  issueChallenge,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  readChallenge,
  sealSecret,
} from '@/server/platform/mfa';

const tenantA = '0190f5a0-0000-7000-8000-00000000000a';
const tenantB = '0190f5a0-0000-7000-8000-00000000000b';
const userId = '0190f5a0-0000-7000-8000-0000000000c1';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
  process.env.MEDHUB_SESSION_SECRET = 'unit-test-session-secret-0000000000000000';
  process.env.MEDHUB_FIELD_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('sealed TOTP secrets', () => {
  it('round-trips with the key of the same structure only', () => {
    const secret = newTotpSecret();
    const sealed = sealSecret(tenantA, secret);
    expect(sealed).not.toContain(secret);
    expect(openSecret(tenantA, sealed)).toBe(secret);
    expect(() => openSecret(tenantB, sealed)).toThrow();
  });
});

describe('TOTP check', () => {
  it('accepts the current code once, then refuses the same time step', async () => {
    const secret = newTotpSecret();
    const token = await generate({ secret });
    const step = await checkTotp(secret, token, null);
    expect(step).not.toBeNull();
    expect(await checkTotp(secret, token, step)).toBeNull();
    expect(await checkTotp(secret, '12345', null)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('are ten distinct codes that survive sloppy typing', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    const [first] = codes as [string];
    expect(normalizeRecoveryCode(first.toLowerCase().replace('-', ' '))).toBe(first);
    expect(hashRecoveryCode(first)).toHaveLength(64);
    expect(normalizeRecoveryCode('ABCDE-01234')).toBeNull();
    expect(normalizeRecoveryCode('short')).toBeNull();
  });
});

describe('sign-in challenge', () => {
  it('is bound to its purpose, signed and short-lived', () => {
    const now = Date.now();
    const token = issueChallenge({ tenantId: tenantA, userId, purpose: 'verify' }, now);
    expect(readChallenge(token, now)).toEqual({ tenantId: tenantA, userId, purpose: 'verify' });
    expect(readChallenge(token, now + 6 * 60_000)).toBeNull();
    const forged = token.replace('.verify.', '.enroll.');
    expect(readChallenge(forged, now)).toBeNull();
    const enroll = issueChallenge({ tenantId: tenantA, userId, purpose: 'enroll' }, now);
    expect(readChallenge(enroll, now + 10 * 60_000)?.purpose).toBe('enroll');
  });
});
