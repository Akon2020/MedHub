import 'server-only';
import {
  consumeRateLimit,
  recordSecurityEvent,
  schema,
  withSystem,
  type SecurityEventInput,
} from '@medhub/db';
import { AppError, uuidv7 } from '@medhub/shared';
import { gt, isNull, or } from 'drizzle-orm';
import { database } from './db';
import { decideIp, type IpDecision, type IpRuleView } from './ip';
import { logger } from './logger';

const RULE_CACHE_MS = 60_000;
const AUTO_BLOCK_MINUTES = 15;
/** Beyond this multiple of a limit, the address is blocked for a while. */
const AUTO_BLOCK_FACTOR = 3;

const cache = globalThis as unknown as { medhubIpRules?: { at: number; rules: IpRuleView[] } };

export async function activeIpRules(): Promise<IpRuleView[]> {
  const cached = cache.medhubIpRules;
  if (cached && Date.now() - cached.at < RULE_CACHE_MS) return cached.rules;
  const rows = await withSystem(database().db, (tx) =>
    tx
      .select({
        cidr: schema.ipRule.cidr,
        action: schema.ipRule.action,
        scope: schema.ipRule.scope,
        targetTenantId: schema.ipRule.targetTenantId,
      })
      .from(schema.ipRule)
      .where(or(isNull(schema.ipRule.expiresAt), gt(schema.ipRule.expiresAt, new Date()))),
  );
  const rules = rows as IpRuleView[];
  cache.medhubIpRules = { at: Date.now(), rules };
  return rules;
}

function forgetIpRules(): void {
  cache.medhubIpRules = undefined;
}

export async function checkIp(
  ip: string | null,
  target: { area: 'public' | 'admin' | 'tenant'; tenantId?: string | null },
): Promise<IpDecision> {
  return decideIp(ip, await activeIpRules(), target);
}

/** Never lets a security record break the request that triggered it. */
export async function securityEvent(event: SecurityEventInput): Promise<void> {
  try {
    await withSystem(database().db, (tx) => recordSecurityEvent(tx, event));
  } catch (error) {
    logger.error(
      { security: event.kind, err: error instanceof Error ? error.message : String(error) },
      'security_event_write_failed',
    );
  }
}

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  loginByIp: { name: 'login-ip', limit: 30, windowSeconds: 300 },
  loginByAccount: { name: 'login-account', limit: 10, windowSeconds: 300 },
  mfaByUser: { name: 'mfa-user', limit: 8, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/**
 * Counts one attempt for `subject` and refuses beyond the limit. An address
 * that keeps hammering far beyond the limit gets a temporary automatic block.
 */
export async function enforceRateLimit(
  rule: RateLimitRule,
  subject: string,
  context: { ip: string | null; tenantId?: string | null },
): Promise<void> {
  const hit = await withSystem(database().db, (tx) =>
    consumeRateLimit(tx, `${rule.name}:${subject}`, rule.windowSeconds),
  );
  if (hit.hits <= rule.limit) return;
  const retryAfter = Math.max(
    1,
    Math.ceil((hit.windowStart.getTime() + rule.windowSeconds * 1000 - Date.now()) / 1000),
  );
  if (hit.hits === rule.limit + 1) {
    await securityEvent({
      kind: 'rate_limited',
      severity: 'warning',
      tenantId: context.tenantId ?? null,
      ip: context.ip,
      detail: { rule: rule.name },
    });
  }
  if (context.ip && hit.hits === rule.limit * AUTO_BLOCK_FACTOR) {
    await withSystem(database().db, async (tx) => {
      await tx.insert(schema.ipRule).values({
        id: uuidv7(),
        cidr: context.ip as string,
        action: 'block',
        scope: 'platform',
        reason: `auto:${rule.name}`,
        origin: 'auto',
        expiresAt: new Date(Date.now() + AUTO_BLOCK_MINUTES * 60_000),
      });
      await recordSecurityEvent(tx, {
        kind: 'ip_auto_blocked',
        severity: 'critical',
        tenantId: context.tenantId ?? null,
        ip: context.ip,
        detail: { rule: rule.name, minutes: AUTO_BLOCK_MINUTES },
      });
    });
    forgetIpRules();
  }
  throw new AppError('RATE_LIMITED', 429, { retryAfter });
}
