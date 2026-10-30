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
  uuid,
} from 'drizzle-orm/pg-core';

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
