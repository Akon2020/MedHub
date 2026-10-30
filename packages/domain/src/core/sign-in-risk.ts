/**
 * Unusual sign-in detection (docs/03-multitenant-securite.md section 2): a new
 * device or an hour the user never signs in at. No location: the platform has
 * no geolocation source yet.
 */

export type DeviceSignature = { browser: string; system: string };

export function deviceSignature(userAgent: string | null | undefined): DeviceSignature {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const system = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return { browser, system };
}

export function deviceLabel(userAgent: string | null | undefined): string {
  const { browser, system } = deviceSignature(userAgent);
  return [browser, system].filter(Boolean).join(' · ');
}

export type SignInAnomaly = 'new_device' | 'unusual_hour';

export type PastSignIn = { at: Date; userAgent: string | null };

/** Minimum history before an hour can be called unusual. */
export const UNUSUAL_HOUR_MIN_HISTORY = 10;

export function localHour(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone })
    .format(at)
    .slice(0, 2);
  return Number(hour);
}

function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/**
 * Compares a successful sign-in with the user's previous ones. The very first
 * sign-in of an account is never an anomaly: there is nothing to compare with.
 */
export function assessSignIn(
  history: readonly PastSignIn[],
  current: { at: Date; userAgent: string | null },
  timeZone: string,
): SignInAnomaly[] {
  if (history.length === 0) return [];
  const anomalies: SignInAnomaly[] = [];
  const signature = deviceSignature(current.userAgent);
  const known = history.some((h) => {
    const past = deviceSignature(h.userAgent);
    return past.browser === signature.browser && past.system === signature.system;
  });
  if (!known) anomalies.push('new_device');
  if (history.length >= UNUSUAL_HOUR_MIN_HISTORY) {
    const hour = localHour(current.at, timeZone);
    const usual = history.some((h) => hourDistance(localHour(h.at, timeZone), hour) <= 1);
    if (!usual) anomalies.push('unusual_hour');
  }
  return anomalies;
}
