import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appendOnlyColumns, clinicalStatusCheck, syncColumns, tenantColumns } from '../columns';

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

const fieldMeta = () =>
  jsonb('field_meta').$type<Record<string, { hlc: string; v: number }>>().notNull().default({});

/** A visit: opened at arrival, with or without appointment (docs/04 section 6). */
export const encounter = pgTable(
  'encounter',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    departmentId: uuid('department_id'),
    practitionerId: uuid('practitioner_id'),
    appointmentId: uuid('appointment_id'),
    visitNumber: text('visit_number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    fieldMeta: fieldMeta(),
  },
  (t) => [
    index('encounter_patient_idx').on(t.tenantId, t.patientId, t.startedAt),
    index('encounter_day_idx').on(t.tenantId, t.startedAt),
    uniqueIndex('encounter_visit_number_uq').on(t.tenantId, t.visitNumber),
    check(
      'encounter_kind_check',
      sql`${t.kind} in ('outpatient','emergency','inpatient','day_care','teleconsult','lab_only','pharmacy_only')`,
    ),
    check(
      'encounter_status_check',
      sql`${t.status} in ('planned','arrived','triaged','in_consultation','waiting_results','completed','cancelled')`,
    ),
  ],
);

/** Waiting-queue ticket: never deleted, a patient who leaves is marked `left`. */
export const queueTicket = pgTable(
  'queue_ticket',
  {
    ...syncColumns(),
    queueId: uuid('queue_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    number: text('number').notNull(),
    priority: text('priority').notNull(),
    status: text('status').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    calledAt: timestamp('called_at', { withTimezone: true }),
    room: text('room'),
    serviceStartedAt: timestamp('service_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
    fieldMeta: fieldMeta(),
  },
  (t) => [
    index('queue_ticket_queue_idx').on(t.tenantId, t.queueId, t.issuedAt),
    index('queue_ticket_patient_idx').on(t.tenantId, t.patientId),
    check(
      'queue_ticket_priority_check',
      sql`${t.priority} in ('emergency','elderly','pregnant','child','normal')`,
    ),
    check(
      'queue_ticket_status_check',
      sql`${t.status} in ('waiting','called','in_service','done','left')`,
    ),
  ],
);

/** Triage of a visit, append-only: corrections supersede the previous row. */
export const triage = pgTable(
  'triage',
  {
    ...appendOnlyColumns(),
    encounterId: uuid('encounter_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    priority: text('priority').notNull(),
    chiefComplaint: text('chief_complaint').notNull(),
    notes: text('notes'),
    orientationQueueId: uuid('orientation_queue_id'),
    triagedAt: timestamp('triaged_at', { withTimezone: true }).notNull(),
    triagedBy: uuid('triaged_by'),
  },
  (t) => [
    index('triage_encounter_idx').on(t.tenantId, t.encounterId),
    index('triage_patient_idx').on(t.tenantId, t.patientId),
    check('triage_status_check', clinicalStatusCheck),
    check(
      'triage_priority_check',
      sql`${t.priority} in ('emergency','elderly','pregnant','child','normal')`,
    ),
  ],
);

/** Appointment on an agenda slot; the slot is checked when the booking reaches the server. */
export const appointment = pgTable(
  'appointment',
  {
    ...syncColumns(),
    patientId: uuid('patient_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    appointmentTypeId: uuid('appointment_type_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    cancelReason: text('cancel_reason'),
    source: text('source').notNull().default('front_desk'),
    notes: text('notes'),
    reminderStatus: text('reminder_status'),
    fieldMeta: fieldMeta(),
  },
  (t) => [
    index('appointment_resource_idx').on(t.tenantId, t.resourceId, t.startsAt),
    index('appointment_patient_idx').on(t.tenantId, t.patientId, t.startsAt),
    check('appointment_resource_check', sql`${t.resourceKind} ${RESOURCE_KIND_CHECK}`),
    check(
      'appointment_status_check',
      sql`${t.status} in ('booked','confirmed','arrived','no_show','cancelled','completed')`,
    ),
    check('appointment_source_check', sql`${t.source} in ('front_desk','portal','recurring')`),
  ],
);
