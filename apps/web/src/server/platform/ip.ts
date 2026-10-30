/**
 * Pure address matching for `ip_rule`. IPv4 supports CIDR ranges; IPv6 is
 * matched by prefix length on its expanded form. IPv4-mapped IPv6 addresses
 * ("::ffff:10.0.0.1"), as Node often reports them, are treated as IPv4.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function expandIpv6(ip: string): bigint | null {
  if (!ip.includes(':')) return null;
  const [head = '', tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0 || (!ip.includes('::') && headParts.length !== 8)) return null;
  const groups = [...headParts, ...Array<string>(missing).fill('0'), ...tailParts];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}

export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

export function ipMatches(rawIp: string, cidr: string): boolean {
  const ip = normalizeIp(rawIp);
  const [base = '', prefixText] = cidr.trim().split('/');
  const v4 = ipv4ToInt(ip);
  const base4 = ipv4ToInt(normalizeIp(base));
  if (v4 !== null && base4 !== null) {
    const prefix = prefixText === undefined ? 32 : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const shift = 32 - prefix;
    return Math.floor(v4 / 2 ** shift) === Math.floor(base4 / 2 ** shift);
  }
  const v6 = expandIpv6(ip);
  const base6 = expandIpv6(base);
  if (v6 === null || base6 === null) return false;
  const prefix = prefixText === undefined ? 128 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;
  const shift = BigInt(128 - prefix);
  return v6 >> shift === base6 >> shift;
}

export type IpRuleView = {
  cidr: string;
  action: 'block' | 'allow' | 'monitor';
  scope: 'platform' | 'admin' | 'tenant';
  targetTenantId: string | null;
};

export type IpDecision = { allowed: boolean; monitored: boolean; rule: IpRuleView | null };

/**
 * Platform and admin rules apply before any structure is known. For a structure,
 * an `allow` rule turns its rules into an allow list.
 */
export function decideIp(
  ip: string | null,
  rules: readonly IpRuleView[],
  target: { area: 'public' | 'admin' | 'tenant'; tenantId?: string | null },
): IpDecision {
  if (!ip) return { allowed: true, monitored: false, rule: null };
  const applicable = rules.filter((r) => {
    if (r.scope === 'platform') return true;
    if (r.scope === 'admin') return target.area === 'admin';
    return target.area === 'tenant' && r.targetTenantId === target.tenantId;
  });
  const matching = applicable.filter((r) => ipMatches(ip, r.cidr));
  const block = matching.find((r) => r.action === 'block');
  const allow = matching.find((r) => r.action === 'allow');
  const monitored = matching.some((r) => r.action === 'monitor');
  if (block && !allow) return { allowed: false, monitored, rule: block };
  const tenantAllowList = applicable.filter((r) => r.scope === 'tenant' && r.action === 'allow');
  if (tenantAllowList.length > 0 && !tenantAllowList.some((r) => ipMatches(ip, r.cidr))) {
    return { allowed: false, monitored, rule: tenantAllowList[0] ?? null };
  }
  return { allowed: true, monitored, rule: null };
}
