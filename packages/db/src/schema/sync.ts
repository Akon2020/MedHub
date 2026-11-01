import { sql } from 'drizzle-orm';
import {
  bigserial,
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

/** The primary key on op_id is the idempotence guarantee of the sync protocol. */
export const opLog = pgTable(
  'op_log',
  {
    opId: uuid('op_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    userId: uuid('user_id').notNull(),
    command: text('command').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    hlc: text('hlc').notNull(),
    clientTs: timestamp('client_ts', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull(),
    result: jsonb('result').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    signature: text('signature').notNull(),
    clockSuspect: boolean('clock_suspect').notNull().default(false),
  },
  (t) => [
    index('op_log_device_idx').on(t.tenantId, t.deviceId, t.receivedAt),
    index('op_log_entity_idx').on(t.tenantId, t.entity, t.entityId),
    check(
      'op_log_status_check',
      sql`${t.status} in ('applied','merged','duplicate','rejected','needs_review')`,
    ),
  ],
);

export const changeLog = pgTable(
  'change_log',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    version: integer('version').notNull(),
    opId: uuid('op_id'),
    scopeKeys: text('scope_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('change_log_tenant_seq_idx').on(t.tenantId, t.seq)],
);

export const syncConflict = pgTable(
  'sync_conflict',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    opId: uuid('op_id').notNull(),
    kind: text('kind').notNull(),
    serverValue: jsonb('server_value'),
    clientValue: jsonb('client_value'),
    status: text('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sync_conflict_open_idx').on(t.tenantId, t.status),
    check('sync_conflict_status_check', sql`${t.status} in ('open','resolved','dismissed')`),
  ],
);

/**
 * Synchronisation scope (docs/02-offline-sync.md section 8): one default rule
 * per entity for the structure (role_id null) and optional rules per role.
 */
export const syncScopeRule = pgTable(
  'sync_scope_rule',
  {
    ...tenantColumns(),
    roleId: uuid('role_id'),
    entity: text('entity').notNull(),
    rule: jsonb('rule').$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('sync_scope_rule_default_uq')
      .on(t.tenantId, t.entity)
      .where(sql`${t.roleId} is null`),
    uniqueIndex('sync_scope_rule_role_uq')
      .on(t.tenantId, t.entity, t.roleId)
      .where(sql`${t.roleId} is not null`),
  ],
);

/**
 * Patients a device holds under a scoped rule: what the server already sent,
 * so that a patient entering the scope arrives with its whole record, and the
 * patients opened from a server search (pinned), which stay in the scope.
 */
export const devicePatient = pgTable(
  'device_patient',
  {
    ...tenantColumns(),
    deviceId: uuid('device_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    pinned: boolean('pinned').notNull().default(false),
  },
  (t) => [uniqueIndex('device_patient_uq').on(t.tenantId, t.deviceId, t.patientId)],
);
