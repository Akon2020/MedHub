/**
 * Offline evaluation of the platform tokens (docs/02-offline-sync.md section 9).
 * "Now" is never earlier than the last server time seen by the device, so that
 * turning the device clock back does not extend a token.
 */

export function effectiveNow(deviceNowMs: number, lastServerTimeMs: number | null): number {
  return lastServerTimeMs !== null && lastServerTimeMs > deviceNowMs
    ? lastServerTimeMs
    : deviceNowMs;
}

export type OfflineAccess = 'valid' | 'expiring' | 'expired';

/** Warn three days before the offline token expires. */
export const OFFLINE_EXPIRY_WARNING_MS = 3 * 86_400_000;
export const OFFLINE_TOKEN_DEFAULT_DAYS = 14;
export const OFFLINE_TOKEN_MAX_DAYS = 30;

export function offlineAccess(expSeconds: number, nowMs: number): OfflineAccess {
  const exp = expSeconds * 1000;
  if (nowMs >= exp) return 'expired';
  return exp - nowMs <= OFFLINE_EXPIRY_WARNING_MS ? 'expiring' : 'valid';
}

export type LicenseDates = {
  state: string;
  validUntil: number;
  graceAt: number | null;
  readOnlyAt: number | null;
  suspendAt: number | null;
};

export type LicensePhase = 'ok' | 'grace' | 'read_only' | 'suspended';

/**
 * The unpaid cycle applied without a connection: the furthest stage reached by
 * the dates in the token, or the state the server wrote in it. Emergency access
 * and data export never depend on the result (AGENTS.md rule 9).
 */
export function licensePhase(license: LicenseDates, nowMs: number): LicensePhase {
  const now = Math.floor(nowMs / 1000);
  const reached = (at: number | null) => at !== null && now >= at;
  if (license.state === 'suspended' || reached(license.suspendAt)) return 'suspended';
  if (license.state === 'read_only' || reached(license.readOnlyAt)) return 'read_only';
  if (license.state === 'grace' || license.state === 'past_due' || reached(license.graceAt))
    return 'grace';
  // An outdated token without dates is not punished offline: the next sync renews it.
  return 'ok';
}
