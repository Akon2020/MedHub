import 'server-only';
import { OFFLINE_TOKEN_DEFAULT_DAYS, OFFLINE_TOKEN_MAX_DAYS } from '@medhub/domain';
import { AppError, MODULES } from '@medhub/shared';
import {
  base64ToBytes,
  permissionFingerprint,
  signToken,
  type LicenseState,
  type SigningKeys,
} from '@medhub/sync';
import { env } from './env';

/** The license is re-issued at every sync; a month of validity covers long outages. */
const LICENSE_VALIDITY_DAYS = 30;

function signingMaterial(): { kid: string; secretKey: Uint8Array; publicKey: string } {
  const { MEDHUB_SIGNING_KID: kid, MEDHUB_SIGNING_PRIVATE_KEY: priv } = env();
  const pub = env().MEDHUB_SIGNING_PUBLIC_KEY;
  if (!kid || !priv || !pub) throw new AppError('SIGNING_KEY_MISSING', 500);
  return { kid, secretKey: base64ToBytes(priv), publicKey: pub };
}

/**
 * Public keys the devices accept: the current one and the previous ones still
 * listed in MEDHUB_SIGNING_PREVIOUS_KEYS ("kid:base64,kid:base64"), for rotation.
 */
/** Public key that seals diagnostic journals for support; null until configured. */
export function supportPublicKey(): string | null {
  return env().MEDHUB_SUPPORT_PUBLIC_KEY ?? null;
}

export function platformSigningKeys(): SigningKeys {
  const { kid, publicKey } = signingMaterial();
  const keys: SigningKeys = { [kid]: publicKey };
  for (const entry of (env().MEDHUB_SIGNING_PREVIOUS_KEYS ?? '').split(',')) {
    const [previousKid, previousKey] = entry.trim().split(':');
    if (previousKid && previousKey) keys[previousKid] = previousKey;
  }
  return keys;
}

export function issueOfflineToken(input: {
  tenantId: string;
  userId: string;
  deviceId: string;
  permissions: Iterable<string>;
  days?: number;
}): string {
  const { kid, secretKey } = signingMaterial();
  const days = Math.min(input.days ?? OFFLINE_TOKEN_DEFAULT_DAYS, OFFLINE_TOKEN_MAX_DAYS);
  const iat = Math.floor(Date.now() / 1000);
  return signToken(
    {
      typ: 'offline',
      sub: input.userId,
      tid: input.tenantId,
      did: input.deviceId,
      perm: permissionFingerprint(input.permissions),
      iat,
      exp: iat + days * 86_400,
    },
    secretKey,
    kid,
  );
}

const LICENSE_STATES = new Set<LicenseState>([
  'trial',
  'active',
  'past_due',
  'grace',
  'read_only',
  'suspended',
]);

/**
 * Until subscriptions exist (SADM, S14) the license mirrors the structure
 * status and opens every MVP module; no plan, price or limit is invented.
 */
export function issueLicenseToken(tenant: { id: string; status: string }): string {
  const { kid, secretKey } = signingMaterial();
  const iat = Math.floor(Date.now() / 1000);
  const state = LICENSE_STATES.has(tenant.status as LicenseState)
    ? (tenant.status as LicenseState)
    : 'suspended';
  return signToken(
    {
      typ: 'license',
      tid: tenant.id,
      plan: null,
      modules: MODULES.filter((m) => m.phase === 'mvp').map((m) => m.code),
      limits: {},
      state,
      iat,
      validUntil: iat + LICENSE_VALIDITY_DAYS * 86_400,
      graceAt: null,
      readOnlyAt: null,
      suspendAt: null,
    },
    secretKey,
    kid,
  );
}
