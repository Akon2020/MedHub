import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { isUuid } from '@medhub/shared';
import { env } from './env';

const ISSUER = 'MedHub';
/** One period of drift each way, as most authenticator apps expect. */
const EPOCH_TOLERANCE_SECONDS = 30;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;

export type ChallengePurpose = 'verify' | 'enroll';
export type Challenge = { tenantId: string; userId: string; purpose: ChallengePurpose };

const CHALLENGE_TTL_SECONDS: Record<ChallengePurpose, number> = { verify: 300, enroll: 900 };

function fieldKey(tenantId: string): Buffer {
  const master = Buffer.from(env().MEDHUB_FIELD_MASTER_KEY, 'base64');
  return Buffer.from(hkdfSync('sha256', master, Buffer.from(tenantId), 'medhub:mfa:v1', 32));
}

/** AES-256-GCM with a per-structure key: a leaked database alone reveals no secret. */
export function sealSecret(tenantId: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fieldKey(tenantId), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

export function openSecret(tenantId: string, sealed: string): string {
  const [version, iv, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !body) throw new Error('unsupported sealed secret');
  const raw = Buffer.from(body, 'base64url');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    fieldKey(tenantId),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([
    decipher.update(raw.subarray(0, raw.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

export function newTotpSecret(): string {
  return generateSecret();
}

export async function enrollmentMaterial(
  secret: string,
  account: string,
  structureCode: string,
): Promise<{ uri: string; qrSvg: string }> {
  const uri = generateURI({ issuer: ISSUER, label: `${structureCode}:${account}`, secret });
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { uri, qrSvg };
}

/** Returns the accepted time step, or null. Steps at or before `lastStep` are refused (replay). */
export async function checkTotp(
  secret: string,
  token: string,
  lastStep: number | null,
): Promise<number | null> {
  if (!/^\d{6}$/.test(token)) return null;
  const result = await verify({
    secret,
    token,
    epochTolerance: EPOCH_TOLERANCE_SECONDS,
    ...(lastStep !== null ? { afterTimeStep: lastStep } : {}),
  });
  return result.valid && 'timeStep' in result ? result.timeStep : null;
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let raw = '';
    for (let i = 0; i < 10; i += 1) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Accepts the code with or without dash, spaces or lowercase letters. */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  if (compact.length !== 10 || [...compact].some((c) => !RECOVERY_ALPHABET.includes(c)))
    return null;
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function mac(value: string): string {
  return createHmac('sha256', env().MEDHUB_SESSION_SECRET)
    .update(`mfa-challenge:${value}`)
    .digest('base64url');
}

/**
 * Stateless proof that the password step succeeded. It grants nothing by itself:
 * the second factor is still required and failures feed the account lockout.
 */
export function issueChallenge(challenge: Challenge, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + CHALLENGE_TTL_SECONDS[challenge.purpose];
  const value = `${challenge.tenantId}.${challenge.userId}.${challenge.purpose}.${expires}`;
  return `${value}.${mac(value)}`;
}

export function readChallenge(token: string, now = Date.now()): Challenge | null {
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [tenantId, userId, purpose, expires, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(mac(`${tenantId}.${userId}.${purpose}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!isUuid(tenantId) || !isUuid(userId)) return null;
  if (purpose !== 'verify' && purpose !== 'enroll') return null;
  if (Number(expires) * 1000 < now) return null;
  return { tenantId, userId, purpose };
}
