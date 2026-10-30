import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Platform tables (no tenant_id column, so no tenant RLS): they protect the
 * platform before a structure is even known, and hold no health data.
 */

/** Fixed-window counters for rate limiting, keyed by purpose and subject. */
export const rateLimit = pgTable('rate_limit', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  hits: integer('hits').notNull().default(0),
});

export const ipRule = pgTable(
  'ip_rule',
  {
    id: uuid('id').primaryKey(),
    cidr: text('cidr').notNull(),
    action: text('action').notNull(),
    scope: text('scope').notNull().default('platform'),
    targetTenantId: uuid('target_tenant_id'),
    reason: text('reason').notNull(),
    origin: text('origin').notNull().default('manual'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('ip_rule_scope_idx').on(t.scope, t.targetTenantId),
    check('ip_rule_action_check', sql`${t.action} in ('block','allow','monitor')`),
    check('ip_rule_scope_check', sql`${t.scope} in ('platform','admin','tenant')`),
    check('ip_rule_origin_check', sql`${t.origin} in ('manual','auto')`),
  ],
);

/** Security events (brute force, automatic blocks, MFA changes), append only. */
export const securityEvent = pgTable(
  'security_event',
  {
    id: uuid('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('info'),
    targetTenantId: uuid('target_tenant_id'),
    userId: uuid('user_id'),
    ip: text('ip'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('security_event_at_idx').on(t.at),
    index('security_event_tenant_idx').on(t.targetTenantId, t.at),
    check('security_event_severity_check', sql`${t.severity} in ('info','warning','critical')`),
  ],
);
