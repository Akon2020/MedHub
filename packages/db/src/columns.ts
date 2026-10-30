import { sql } from 'drizzle-orm';
import { integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Common columns of every synchronized business table (docs/04-modele-donnees.md). */
export function syncColumns() {
  return {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    version: integer('version').notNull().default(1),
    deviceId: uuid('device_id'),
    hlc: text('hlc'),
    opId: uuid('op_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deleteReason: text('delete_reason'),
  };
}

/** Append-only clinical and ledger tables: no updated_* columns, corrections by supersedes_id. */
export function appendOnlyColumns() {
  return {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    version: integer('version').notNull().default(1),
    deviceId: uuid('device_id'),
    hlc: text('hlc'),
    opId: uuid('op_id'),
    supersedesId: uuid('supersedes_id'),
    status: text('status').notNull().default('active'),
  };
}

export const clinicalStatusCheck = sql`status in ('active', 'superseded', 'entered_in_error')`;

/** Tenant-scoped configuration and reference tables (not synchronized by op log). */
export function tenantColumns() {
  return {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  };
}
