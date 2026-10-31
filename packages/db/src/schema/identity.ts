import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../columns';

export const userAccount = pgTable(
  'user_account',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id'),
    username: text('username').notNull(),
    phone: text('phone'),
    email: text('email'),
    displayName: text('display_name').notNull(),
    title: text('title'),
    professionalNumber: text('professional_number'),
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    status: text('status').notNull().default('active'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    locale: text('locale').notNull().default('fr'),
    defaultSiteId: uuid('default_site_id'),
    defaultDepartmentId: uuid('default_department_id'),
    isPlatformStaff: boolean('is_platform_staff').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** TOTP secret sealed with a key derived from MEDHUB_FIELD_MASTER_KEY; pending until mfa_enabled_at. */
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    /** Last accepted TOTP time step: a code is never accepted twice. */
    mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_username_uq').on(t.tenantId, t.username),
    check('user_status_check', sql`${t.status} in ('active','disabled','locked')`),
  ],
);

export const role = pgTable(
  'role',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPrivileged: boolean('is_privileged').notNull().default(false),
    requiresMfa: boolean('requires_mfa').notNull().default(false),
    templateCode: text('template_code'),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('role_code_uq').on(t.tenantId, t.code)],
);

/** Platform reference catalog of permission keys. */
export const permission = pgTable('permission', {
  key: text('key').primaryKey(),
  moduleCode: text('module_code').notNull(),
  description: text('description'),
  scopesAllowed: text('scopes_allowed')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

export const rolePermission = pgTable(
  'role_permission',
  {
    tenantId: uuid('tenant_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
    scope: text('scope').notNull().default('tenant'),
    conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.roleId, t.permissionKey] }),
    check(
      'role_permission_scope_check',
      sql`${t.scope} in ('self','department','site','tenant','warehouse','cash_register','patient')`,
    ),
  ],
);

export const userRole = pgTable(
  'user_role',
  {
    ...tenantColumns(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    siteId: uuid('site_id'),
    departmentId: uuid('department_id'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
  },
  (t) => [index('user_role_user_idx').on(t.tenantId, t.userId)],
);

/** Ten single-use recovery codes per user; only their SHA-256 is stored. */
export const mfaRecoveryCode = pgTable(
  'mfa_recovery_code',
  {
    ...tenantColumns(),
    userId: uuid('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('mfa_recovery_user_idx').on(t.tenantId, t.userId)],
);

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    deviceId: uuid('device_id'),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Last time the second factor was proven in this session (step-up for sensitive changes). */
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
    /** Session this one replaced when its identifier was rotated. */
    rotatedFrom: uuid('rotated_from'),
  },
  (t) => [
    uniqueIndex('session_token_uq').on(t.tenantId, t.tokenHash),
    index('session_user_idx').on(t.tenantId, t.userId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id'),
    deviceId: uuid('device_id'),
    ip: text('ip'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: uuid('entity_id'),
    patientId: uuid('patient_id'),
    reason: text('reason'),
    diff: jsonb('diff').$type<Record<string, unknown>>(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    uniqueIndex('audit_log_seq_uq').on(t.tenantId, t.seq),
    index('audit_log_entity_idx').on(t.tenantId, t.entity, t.entityId),
    index('audit_log_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const dataAccessLog = pgTable(
  'data_access_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').notNull(),
    deviceId: uuid('device_id'),
    patientId: uuid('patient_id').notNull(),
    screen: text('screen').notNull(),
    reason: text('reason'),
  },
  (t) => [index('data_access_patient_idx').on(t.tenantId, t.patientId, t.at)],
);

/** Platform table: every super-admin action, visible to the structure concerned. */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: uuid('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    targetTenantId: uuid('target_tenant_id'),
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [index('platform_audit_tenant_idx').on(t.targetTenantId, t.at)],
);
