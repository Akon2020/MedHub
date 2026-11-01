import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../columns';

const RESOURCE_KIND_CHECK = sql`in ('practitioner','department','room','equipment')`;

/** Waiting queue of a service: tickets carry its prefix (docs/modules/rdv.md). */
export const queue = pgTable(
  'queue',
  {
    ...tenantColumns(),
    siteId: uuid('site_id').notNull(),
    departmentId: uuid('department_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ticketPrefix: text('ticket_prefix').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('queue_code_uq').on(t.tenantId, t.code),
    check('queue_prefix_format', sql`${t.ticketPrefix} ~ '^[A-Z]{1,3}$'`),
  ],
);

export const appointmentType = pgTable(
  'appointment_type',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    durationMin: integer('duration_min').notNull(),
    color: text('color').notNull().default('#0f6b6b'),
    departmentId: uuid('department_id'),
    requiresPayment: boolean('requires_payment').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('appointment_type_code_uq').on(t.tenantId, t.code)],
);

/** Weekly opening hours of a resource, cut into slots; replaced as a whole. */
export const scheduleTemplate = pgTable(
  'schedule_template',
  {
    ...tenantColumns(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    slotMin: integer('slot_min').notNull(),
    overbookMax: integer('overbook_max').notNull().default(0),
  },
  (t) => [
    index('schedule_template_resource_idx').on(t.tenantId, t.resourceId, t.weekday),
    check('schedule_template_kind_check', sql`${t.resourceKind} ${RESOURCE_KIND_CHECK}`),
    check('schedule_template_weekday_check', sql`${t.weekday} between 1 and 7`),
  ],
);

export const scheduleException = pgTable(
  'schedule_exception',
  {
    ...tenantColumns(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    slotMin: integer('slot_min'),
    reason: text('reason'),
  },
  (t) => [
    index('schedule_exception_resource_idx').on(t.tenantId, t.resourceId, t.date),
    check('schedule_exception_kind_check', sql`${t.kind} in ('closed','extra')`),
    check('schedule_exception_resource_check', sql`${t.resourceKind} ${RESOURCE_KIND_CHECK}`),
  ],
);
