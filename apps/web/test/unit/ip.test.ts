import { describe, expect, it } from 'vitest';
import { decideIp, ipMatches, type IpRuleView } from '@/server/platform/ip';

describe('ipMatches', () => {
  it('matches IPv4 addresses and ranges', () => {
    expect(ipMatches('41.243.12.7', '41.243.12.7')).toBe(true);
    expect(ipMatches('41.243.12.7', '41.243.0.0/16')).toBe(true);
    expect(ipMatches('41.244.12.7', '41.243.0.0/16')).toBe(false);
    expect(ipMatches('10.1.2.3', '0.0.0.0/0')).toBe(true);
    expect(ipMatches('10.1.2.3', '10.1.2.0/31')).toBe(false);
  });

  it('treats IPv4-mapped IPv6 addresses as IPv4', () => {
    expect(ipMatches('::ffff:192.168.1.20', '192.168.1.0/24')).toBe(true);
  });

  it('matches IPv6 prefixes', () => {
    expect(ipMatches('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipMatches('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipMatches('::1', '::1')).toBe(true);
  });

  it('never matches malformed input', () => {
    expect(ipMatches('not-an-ip', '10.0.0.0/8')).toBe(false);
    expect(ipMatches('10.0.0.1', '10.0.0.0/40')).toBe(false);
    expect(ipMatches('300.0.0.1', '0.0.0.0/0')).toBe(false);
  });
});

describe('decideIp', () => {
  const tenantId = '0190f5a0-0000-7000-8000-000000000001';
  const rules: IpRuleView[] = [
    { cidr: '198.51.100.0/24', action: 'block', scope: 'platform', targetTenantId: null },
    { cidr: '198.51.100.7', action: 'allow', scope: 'platform', targetTenantId: null },
    { cidr: '203.0.113.0/24', action: 'block', scope: 'admin', targetTenantId: null },
    { cidr: '192.0.2.0/24', action: 'monitor', scope: 'platform', targetTenantId: null },
  ];

  it('blocks platform rules everywhere, except an explicit allow', () => {
    expect(decideIp('198.51.100.9', rules, { area: 'public' }).allowed).toBe(false);
    expect(decideIp('198.51.100.7', rules, { area: 'public' }).allowed).toBe(true);
  });

  it('applies admin rules to the admin area only', () => {
    expect(decideIp('203.0.113.5', rules, { area: 'admin' }).allowed).toBe(false);
    expect(decideIp('203.0.113.5', rules, { area: 'tenant', tenantId }).allowed).toBe(true);
  });

  it('turns structure allow rules into an allow list', () => {
    const withAllowList: IpRuleView[] = [
      ...rules,
      { cidr: '41.243.0.0/16', action: 'allow', scope: 'tenant', targetTenantId: tenantId },
    ];
    expect(decideIp('41.243.1.1', withAllowList, { area: 'tenant', tenantId }).allowed).toBe(true);
    expect(decideIp('8.8.8.8', withAllowList, { area: 'tenant', tenantId }).allowed).toBe(false);
    expect(decideIp('8.8.8.8', withAllowList, { area: 'tenant', tenantId: 'other' }).allowed).toBe(
      true,
    );
  });

  it('flags monitored addresses without refusing them', () => {
    expect(decideIp('192.0.2.4', rules, { area: 'public' })).toMatchObject({
      allowed: true,
      monitored: true,
    });
  });

  it('lets unknown addresses through', () => {
    expect(decideIp(null, rules, { area: 'admin' }).allowed).toBe(true);
  });
});
