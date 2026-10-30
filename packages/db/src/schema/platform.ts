import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../columns';

/** Platform table: no tenant RLS, only reachable from platform and sadm code. */
export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('trial'),
    country: text('country').notNull().default('CD'),
    defaultLocale: text('default_locale').notNull().default('fr'),
    defaultCurrency: text('default_currency').notNull().default('USD'),
    timezone: text('timezone').notNull().default('Africa/Kinshasa'),
    contact: jsonb('contact').$type<Record<string, unknown>>().notNull().default({}),
    billingContact: jsonb('billing_contact').$type<Record<string, unknown>>().notNull().default({}),
    legalMentions: text('legal_mentions'),
    officialNumberingRequired: boolean('official_numbering_required').notNull().default(false),
    isTraining: boolean('is_training').notNull().default(false),
    parentTenantId: uuid('parent_tenant_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_code_uq').on(t.code),
    check('tenant_code_format', sql`${t.code} ~ '^[A-Z]{3}-[A-Z]{3}-[0-9]{4}$'`),
    check(
      'tenant_type_check',
      sql`${t.type} in ('pharmacy','health_center','practice','laboratory','imaging_center','clinic','hospital','network')`,
    ),
    check(
      'tenant_status_check',
      sql`${t.status} in ('prospect','trial','active','past_due','grace','read_only','suspended','terminated','archived')`,
    ),
  ],
);

export const site = pgTable(
  'site',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: jsonb('address').$type<Record<string, unknown>>().notNull().default({}),
    timezone: text('timezone').notNull().default('Africa/Kinshasa'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('site_code_uq').on(t.tenantId, t.code),
    check('site_code_format', sql`${t.code} ~ '^[A-Z]{3}$'`),
  ],
);

/** Departments (services) of a site: scope of roles, queues and reports. */
export const department = pgTable(
  'department',
  {
    ...tenantColumns(),
    siteId: uuid('site_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    costCenterCode: text('cost_center_code'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('department_code_uq').on(t.tenantId, t.siteId, t.code),
    check(
      'department_kind_check',
      sql`${t.kind} in ('clinical','technical','administrative','pharmacy','laboratory','cashier')`,
    ),
  ],
);

/**
 * Versioned simple settings (docs/06-configuration.md section 2). A published
 * version is never changed: a change is a new version, the previous one is
 * archived. Only drafts may be edited or discarded (enforced by a trigger).
 */
export const configEntry = pgTable(
  'config_entry',
  {
    ...tenantColumns(),
    domain: text('domain').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('draft'),
    value: jsonb('value').$type<unknown>().notNull(),
    note: text('note'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    createdBy: uuid('created_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by'),
  },
  (t) => [
    uniqueIndex('config_entry_version_uq').on(t.tenantId, t.key, t.version),
    uniqueIndex('config_entry_draft_uq')
      .on(t.tenantId, t.key)
      .where(sql`${t.status} = 'draft'`),
    uniqueIndex('config_entry_published_uq')
      .on(t.tenantId, t.key)
      .where(sql`${t.status} = 'published'`),
    check('config_entry_status_check', sql`${t.status} in ('draft','published','archived')`),
  ],
);

export const device = pgTable(
  'device',
  {
    ...tenantColumns(),
    userId: uuid('user_id').notNull(),
    deviceCode: text('device_code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    publicKey: text('public_key').notNull(),
    userAgent: text('user_agent'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    appVersion: text('app_version'),
    status: text('status').notNull().default('active'),
    revokedReason: text('revoked_reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    /** Retired device allowed to send its pending operations once before it wipes itself. */
    allowFinalPush: boolean('allow_final_push').notNull().default(false),
  },
  (t) => [
    uniqueIndex('device_code_uq').on(t.tenantId, t.deviceCode),
    index('device_user_idx').on(t.tenantId, t.userId),
    check('device_code_format', sql`${t.deviceCode} ~ '^[A-Z]{2}$'`),
    check('device_kind_check', sql`${t.kind} in ('desktop','laptop','tablet','phone')`),
    check('device_status_check', sql`${t.status} in ('active','revoked','lost')`),
  ],
);

export const numberSeries = pgTable(
  'number_series',
  {
    ...tenantColumns(),
    siteId: uuid('site_id'),
    docType: text('doc_type').notNull(),
    deviceId: uuid('device_id'),
    year: integer('year').notNull(),
    template: text('template').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [uniqueIndex('number_series_uq').on(t.tenantId, t.docType, t.siteId, t.deviceId, t.year)],
);

/**
 * Infrastructure table processed by the cron worker across all structures.
 * Exempt from tenant RLS on purpose; payloads carry identifiers only.
 */
export const job = pgTable(
  'job',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    status: text('status').notNull().default('queued'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('job_due_idx').on(t.status, t.runAt),
    check('job_status_check', sql`${t.status} in ('queued','running','done','failed','dead')`),
  ],
);

export const jobSchedule = pgTable('job_schedule', {
  type: text('type').primaryKey(),
  cron: text('cron').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
});

export const jobTick = pgTable('job_tick', {
  id: uuid('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  processed: integer('processed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  ok: boolean('ok').notNull().default(false),
});

/**
 * Global identity hook for cross-facility sharing (phase 2). Filled with hashes
 * only and never exposed between structures during the MVP.
 */
export const personGlobal = pgTable('person_global', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  familyNameHash: text('family_name_hash'),
  birthYear: integer('birth_year'),
  phoneHash: text('phone_hash'),
  healthQrToken: text('health_qr_token'),
});
