import {
  effectiveNow,
  licensePhase,
  offlineAccess,
  type LicensePhase,
  type OfflineAccess,
} from '@medhub/domain';
import { loadTokens, saveTokens, type MedHubLocalDb } from '@medhub/local-db';
import { verifyToken } from '@medhub/sync';
import { apiFetch } from './api';

export type DeviceTokensResponse = {
  offlineToken: string;
  licenseToken: string;
  signingKeys: Record<string, string>;
  serverTime: number;
  config: { autoLockMinutes: number; pinMaxAttempts: number; duplicateAlertScore?: number };
  supportKey?: string | null;
};

export type TokenStatus = {
  /** "missing" only for devices activated before the tokens existed. */
  offline: OfflineAccess | 'missing' | 'invalid';
  offlineExpiresAt: number | null;
  license: LicensePhase | null;
};

/** Renewed at most once an hour after a successful synchronisation. */
export const TOKEN_REFRESH_INTERVAL_MS = 3_600_000;

export async function storeTokens(db: MedHubLocalDb, tokens: DeviceTokensResponse): Promise<void> {
  await saveTokens(db, {
    offlineToken: tokens.offlineToken,
    licenseToken: tokens.licenseToken,
    signingKeys: tokens.signingKeys,
    config: tokens.config,
    supportKey: tokens.supportKey ?? null,
  });
}

export async function refreshTokens(db: MedHubLocalDb, deviceId: string): Promise<boolean> {
  try {
    const tokens = await apiFetch<DeviceTokensResponse>('/api/v1/devices/tokens', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
    await storeTokens(db, tokens);
    return true;
  } catch {
    return false;
  }
}

export async function tokensDue(db: MedHubLocalDb, now = Date.now()): Promise<boolean> {
  const tokens = await loadTokens(db);
  return !tokens || now - tokens.refreshedAt > TOKEN_REFRESH_INTERVAL_MS;
}

/**
 * Checks the signed tokens without a network: signature with the platform keys
 * received at activation, expiry against the latest of device and server time.
 */
export async function tokenStatus(
  db: MedHubLocalDb,
  identity: { tenantId: string; userId: string; deviceId: string },
  lastServerTime: number | null,
): Promise<TokenStatus> {
  const tokens = await loadTokens(db);
  if (!tokens) return { offline: 'missing', offlineExpiresAt: null, license: null };
  const now = effectiveNow(Date.now(), lastServerTime);
  const offline = verifyToken(tokens.offlineToken, tokens.signingKeys, 'offline');
  const license = verifyToken(tokens.licenseToken, tokens.signingKeys, 'license');
  const matches =
    offline !== null &&
    offline.tid === identity.tenantId &&
    offline.sub === identity.userId &&
    offline.did === identity.deviceId;
  return {
    offline: matches ? offlineAccess(offline.exp, now) : 'invalid',
    offlineExpiresAt: offline ? offline.exp * 1000 : null,
    license: license && license.tid === identity.tenantId ? licensePhase(license, now) : null,
  };
}
