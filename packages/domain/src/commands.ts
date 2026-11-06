import type { ConflictStrategy } from '@medhub/shared';
import type { z } from 'zod';
import { checkVitalPlausibility, vitalSignRecordPayload } from './dpi/vital-signs';
import {
  patientRegisterPayload,
  patientSearchFields,
  patientSensitivityPayload,
  patientUpdatePayload,
  type PatientNameParts,
} from './pat/commands';
import { patientFavoritePayload } from './pat/favorites';
import { blockedByDeath, patientDeathPayload } from './pat/lifecycle';
import { stockMovementRecordPayload } from './phar/stock';
import {
  UPCOMING_STATUSES,
  appointmentBookPayload,
  appointmentCancelPayload,
  appointmentMarkPayload,
  appointmentReschedulePayload,
} from './rdv/appointments';
import { triageRecordPayload } from './rdv/triage';
import { recordAccessPayload } from './dpi/access-log';
import { breakGlassPayload } from './dpi/break-glass';
import { clinicalNotePayload, diagnosisPayload } from './dpi/consultation';
import { formResponseCompletePayload, formResponseSignPayload } from './dpi/form-responses';
import { invoiceFinalizePayload, invoiceLinePayload, invoiceOpenPayload } from './fact/invoice';
import {
  cashSessionClosePayload,
  cashSessionOpenPayload,
  paymentReceivePayload,
} from './fact/payment';
import {
  medicationReconciliationPayload,
  medicationStatementAddPayload,
  medicationStatementStopPayload,
  prescriptionCancelPayload,
  prescriptionCreatePayload,
} from './dpi/prescription';
import { programDischargePayload, programEnrollPayload } from './dpi/programs';
import {
  allergyAddPayload,
  allergyNoneKnownPayload,
  historyAddPayload,
  problemAddPayload,
  problemResolvePayload,
  retractPayload,
} from './dpi/record';
import {
  OPEN_ENCOUNTER_STATUSES,
  TICKET_TRANSITIONS,
  encounterClosePayload,
  encounterOpenPayload,
  encounterStatusPayload,
  ticketCallPayload,
  ticketCompletePayload,
  ticketIssuePayload,
  ticketLeftPayload,
  ticketStartPayload,
} from './rdv/visits';

export type EntityName =
  | 'patient'
  | 'vital_sign'
  | 'stock_movement'
  | 'patient_favorite'
  | 'encounter'
  | 'queue_ticket'
  | 'triage'
  | 'appointment'
  | 'allergy'
  | 'medical_history'
  | 'problem'
  | 'record_access'
  | 'break_glass'
  | 'program_enrollment'
  | 'clinical_note'
  | 'diagnosis'
  | 'form_response'
  | 'prescription'
  | 'medication_statement'
  | 'medication_reconciliation'
  | 'invoice'
  | 'invoice_line'
  | 'cash_session'
  | 'payment';

export type EntityDefinition = {
  name: EntityName;
  strategy: ConflictStrategy;
  /** Recomputes derived columns after any change, identically on client and server. */
  derive?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** Keys used by the pull filter to decide which devices receive a change. */
  scopeKeys: (data: Record<string, unknown>, entityId: string) => string[];
  /** The patient a row belongs to: it follows that patient's access rules and scope. */
  patientIdOf?: (data: Record<string, unknown>, entityId: string) => string | null;
};

export const ENTITIES: Record<EntityName, EntityDefinition> = {
  patient: {
    name: 'patient',
    strategy: 'field_merge',
    derive: (data) =>
      patientSearchFields(
        data as PatientNameParts & {
          phone?: string;
          mrn?: string;
          fatherName?: string;
          motherName?: string;
        },
      ),
    scopeKeys: (_data, id) => [`patient:${id}`],
    patientIdOf: (_data, id) => id,
  },
  vital_sign: {
    name: 'vital_sign',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  patient_favorite: {
    name: 'patient_favorite',
    strategy: 'union',
    // Only the user who marked it receives it: the pull filters on userId.
    scopeKeys: (data) => [`user:${String(data.userId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  encounter: {
    name: 'encounter',
    strategy: 'field_merge',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  queue_ticket: {
    name: 'queue_ticket',
    strategy: 'first_wins',
    scopeKeys: (data) => [`queue:${String(data.queueId)}`, `patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  appointment: {
    name: 'appointment',
    strategy: 'first_wins',
    scopeKeys: (data) => [
      `patient:${String(data.patientId)}`,
      `resource:${String(data.resourceId)}`,
    ],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  allergy: {
    name: 'allergy',
    strategy: 'union',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  medical_history: {
    name: 'medical_history',
    strategy: 'union',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  problem: {
    name: 'problem',
    strategy: 'union',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  clinical_note: {
    name: 'clinical_note',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  diagnosis: {
    name: 'diagnosis',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  prescription: {
    name: 'prescription',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  medication_statement: {
    name: 'medication_statement',
    strategy: 'union',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  medication_reconciliation: {
    name: 'medication_reconciliation',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  invoice: {
    name: 'invoice',
    strategy: 'field_merge',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  invoice_line: {
    name: 'invoice_line',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  form_response: {
    name: 'form_response',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  program_enrollment: {
    name: 'program_enrollment',
    strategy: 'union',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  break_glass: {
    name: 'break_glass',
    strategy: 'append_only',
    // Only the user who opened the access receives it back (pull filter on userId).
    scopeKeys: (data) => [`user:${String(data.userId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  record_access: {
    name: 'record_access',
    strategy: 'append_only',
    // Kept on the server only: no device downloads the access journal.
    scopeKeys: () => [],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  triage: {
    name: 'triage',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  stock_movement: {
    name: 'stock_movement',
    strategy: 'movements',
    scopeKeys: (data) => [`warehouse:${String(data.warehouseId)}`],
  },
  cash_session: {
    name: 'cash_session',
    strategy: 'field_merge',
    scopeKeys: (_data, id) => [`cash_session:${id}`],
  },
  payment: {
    name: 'payment',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
};

export type CommandKind = 'create' | 'update' | 'append';

export type CommandDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  entity: EntityName;
  kind: CommandKind;
  payloadSchema: S;
  permission: string;
  onlineOnly: boolean;
  /** Business rule check shared by client (before dispatch) and server (before apply). */
  check?: (payload: z.infer<S>) => string | null;
  /** Payload keys kept in the operation log only, never merged into the entity. */
  transientFields?: readonly string[];
  /**
   * Status change that only applies from the listed statuses ("first wins"):
   * otherwise the operation is kept in the log and the entity left unchanged.
   * `to` is the status set by the command; without it the payload carries it.
   */
  transition?: { from: readonly string[]; to?: string };
  /**
   * The command takes an appointment slot: the server checks, when the
   * operation arrives, that the slot exists and is not full (first wins).
   */
  holdsSlot?: boolean;
  /** A clinical act on a patient: refused after the patient's recorded death. */
  patientAct?: (payload: z.infer<S>) => { patientId: string; at: string };
};

function define<S extends z.ZodType>(def: CommandDefinition<S>): CommandDefinition<S> {
  return def;
}

export const COMMANDS = {
  'patient.register': define({
    name: 'patient.register',
    entity: 'patient',
    kind: 'create',
    payloadSchema: patientRegisterPayload,
    permission: 'patient:create',
    onlineOnly: false,
  }),
  'patient.update': define({
    name: 'patient.update',
    entity: 'patient',
    kind: 'update',
    payloadSchema: patientUpdatePayload,
    permission: 'patient:update',
    onlineOnly: false,
  }),
  'patient.mark_deceased': define({
    name: 'patient.mark_deceased',
    entity: 'patient',
    kind: 'update',
    payloadSchema: patientDeathPayload,
    permission: 'patient:mark_deceased',
    onlineOnly: false,
    transientFields: ['correctionReason'],
  }),
  'patient.set_sensitivity': define({
    name: 'patient.set_sensitivity',
    entity: 'patient',
    kind: 'update',
    payloadSchema: patientSensitivityPayload,
    permission: 'patient:mark_sensitive',
    onlineOnly: false,
    transientFields: ['sensitivityReason'],
  }),
  'patient.favorite': define({
    name: 'patient.favorite',
    entity: 'patient_favorite',
    kind: 'append',
    payloadSchema: patientFavoritePayload,
    permission: 'patient:read',
    onlineOnly: false,
  }),
  'encounter.open': define({
    name: 'encounter.open',
    entity: 'encounter',
    kind: 'create',
    payloadSchema: encounterOpenPayload,
    permission: 'encounter:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.startedAt }),
  }),
  'encounter.update_status': define({
    name: 'encounter.update_status',
    entity: 'encounter',
    kind: 'update',
    payloadSchema: encounterStatusPayload,
    permission: 'encounter:update_status',
    onlineOnly: false,
    transition: { from: OPEN_ENCOUNTER_STATUSES },
  }),
  'encounter.close': define({
    name: 'encounter.close',
    entity: 'encounter',
    kind: 'update',
    payloadSchema: encounterClosePayload,
    permission: 'encounter:close',
    onlineOnly: false,
    transition: { from: OPEN_ENCOUNTER_STATUSES },
  }),
  'queue_ticket.issue': define({
    name: 'queue_ticket.issue',
    entity: 'queue_ticket',
    kind: 'create',
    payloadSchema: ticketIssuePayload,
    // Whoever handles a queue may give a ticket: front desk at arrival, triage when orienting.
    permission: 'queue:call',
    onlineOnly: false,
  }),
  'queue_ticket.call': define({
    name: 'queue_ticket.call',
    entity: 'queue_ticket',
    kind: 'update',
    payloadSchema: ticketCallPayload,
    permission: 'queue:call',
    onlineOnly: false,
    transition: TICKET_TRANSITIONS['queue_ticket.call'],
  }),
  'queue_ticket.start_service': define({
    name: 'queue_ticket.start_service',
    entity: 'queue_ticket',
    kind: 'update',
    payloadSchema: ticketStartPayload,
    permission: 'queue:call',
    onlineOnly: false,
    transition: TICKET_TRANSITIONS['queue_ticket.start_service'],
  }),
  'queue_ticket.complete': define({
    name: 'queue_ticket.complete',
    entity: 'queue_ticket',
    kind: 'update',
    payloadSchema: ticketCompletePayload,
    permission: 'queue:call',
    onlineOnly: false,
    transition: TICKET_TRANSITIONS['queue_ticket.complete'],
  }),
  'queue_ticket.mark_left': define({
    name: 'queue_ticket.mark_left',
    entity: 'queue_ticket',
    kind: 'update',
    payloadSchema: ticketLeftPayload,
    permission: 'queue:call',
    onlineOnly: false,
    transition: TICKET_TRANSITIONS['queue_ticket.mark_left'],
  }),
  'appointment.book': define({
    name: 'appointment.book',
    entity: 'appointment',
    kind: 'create',
    payloadSchema: appointmentBookPayload,
    permission: 'appointment:create',
    onlineOnly: false,
    holdsSlot: true,
  }),
  'appointment.reschedule': define({
    name: 'appointment.reschedule',
    entity: 'appointment',
    kind: 'update',
    payloadSchema: appointmentReschedulePayload,
    permission: 'appointment:update',
    onlineOnly: false,
    holdsSlot: true,
    transition: { from: UPCOMING_STATUSES },
  }),
  'appointment.cancel': define({
    name: 'appointment.cancel',
    entity: 'appointment',
    kind: 'update',
    payloadSchema: appointmentCancelPayload,
    permission: 'appointment:cancel',
    onlineOnly: false,
    transition: { from: UPCOMING_STATUSES, to: 'cancelled' },
  }),
  'appointment.mark_arrived': define({
    name: 'appointment.mark_arrived',
    entity: 'appointment',
    kind: 'update',
    payloadSchema: appointmentMarkPayload,
    permission: 'appointment:update',
    onlineOnly: false,
    transientFields: ['at'],
    transition: { from: UPCOMING_STATUSES, to: 'arrived' },
  }),
  'appointment.mark_no_show': define({
    name: 'appointment.mark_no_show',
    entity: 'appointment',
    kind: 'update',
    payloadSchema: appointmentMarkPayload,
    permission: 'appointment:update',
    onlineOnly: false,
    transientFields: ['at'],
    transition: { from: UPCOMING_STATUSES, to: 'no_show' },
  }),
  'allergy.add': define({
    name: 'allergy.add',
    entity: 'allergy',
    kind: 'create',
    payloadSchema: allergyAddPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.notedAt }),
  }),
  'allergy.set_none_known': define({
    name: 'allergy.set_none_known',
    entity: 'allergy',
    kind: 'create',
    payloadSchema: allergyNoneKnownPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.notedAt }),
  }),
  'allergy.retract': define({
    name: 'allergy.retract',
    entity: 'allergy',
    kind: 'update',
    payloadSchema: retractPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    transition: { from: ['active'], to: 'retracted' },
  }),
  'medical_history.add': define({
    name: 'medical_history.add',
    entity: 'medical_history',
    kind: 'create',
    payloadSchema: historyAddPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.notedAt }),
  }),
  'medical_history.retract': define({
    name: 'medical_history.retract',
    entity: 'medical_history',
    kind: 'update',
    payloadSchema: retractPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    transition: { from: ['active'], to: 'retracted' },
  }),
  'problem.add': define({
    name: 'problem.add',
    entity: 'problem',
    kind: 'create',
    payloadSchema: problemAddPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.notedAt }),
  }),
  'problem.resolve': define({
    name: 'problem.resolve',
    entity: 'problem',
    kind: 'update',
    payloadSchema: problemResolvePayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    transition: { from: ['active'], to: 'resolved' },
  }),
  'problem.retract': define({
    name: 'problem.retract',
    entity: 'problem',
    kind: 'update',
    payloadSchema: retractPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    transition: { from: ['active', 'resolved'], to: 'retracted' },
  }),
  'clinical_note.sign': define({
    name: 'clinical_note.sign',
    entity: 'clinical_note',
    kind: 'append',
    payloadSchema: clinicalNotePayload,
    permission: 'clinical_record:sign',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.signedAt }),
  }),
  'diagnosis.add': define({
    name: 'diagnosis.add',
    entity: 'diagnosis',
    kind: 'append',
    payloadSchema: diagnosisPayload,
    permission: 'diagnosis:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.diagnosedAt }),
  }),
  'form_response.complete': define({
    name: 'form_response.complete',
    entity: 'form_response',
    kind: 'append',
    payloadSchema: formResponseCompletePayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.completedAt }),
  }),
  'prescription.create': define({
    name: 'prescription.create',
    entity: 'prescription',
    kind: 'append',
    payloadSchema: prescriptionCreatePayload,
    permission: 'prescription:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.prescribedAt }),
  }),
  'prescription.cancel': define({
    name: 'prescription.cancel',
    entity: 'prescription',
    kind: 'update',
    payloadSchema: prescriptionCancelPayload,
    permission: 'prescription:cancel',
    onlineOnly: false,
    transientFields: ['cancelReason'],
    transition: { from: ['active'], to: 'cancelled' },
  }),
  'medication_statement.add': define({
    name: 'medication_statement.add',
    entity: 'medication_statement',
    kind: 'create',
    payloadSchema: medicationStatementAddPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.notedAt }),
  }),
  'medication_statement.stop': define({
    name: 'medication_statement.stop',
    entity: 'medication_statement',
    kind: 'update',
    payloadSchema: medicationStatementStopPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    transition: { from: ['active'], to: 'stopped' },
  }),
  'medication_reconciliation.record': define({
    name: 'medication_reconciliation.record',
    entity: 'medication_reconciliation',
    kind: 'append',
    payloadSchema: medicationReconciliationPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.performedAt }),
  }),
  'invoice.open': define({
    name: 'invoice.open',
    entity: 'invoice',
    kind: 'create',
    payloadSchema: invoiceOpenPayload,
    permission: 'invoice:create',
    onlineOnly: false,
  }),
  'invoice.add_line': define({
    name: 'invoice.add_line',
    entity: 'invoice_line',
    kind: 'append',
    payloadSchema: invoiceLinePayload,
    permission: 'invoice:add_line',
    onlineOnly: false,
  }),
  'invoice.finalize': define({
    name: 'invoice.finalize',
    entity: 'invoice',
    kind: 'update',
    payloadSchema: invoiceFinalizePayload,
    permission: 'invoice:finalize',
    onlineOnly: false,
    transition: { from: ['open'], to: 'finalized' },
  }),
  'cash_session.open': define({
    name: 'cash_session.open',
    entity: 'cash_session',
    kind: 'create',
    payloadSchema: cashSessionOpenPayload,
    permission: 'cash_session:open',
    onlineOnly: false,
  }),
  'cash_session.close': define({
    name: 'cash_session.close',
    entity: 'cash_session',
    kind: 'update',
    payloadSchema: cashSessionClosePayload,
    permission: 'cash_session:close',
    onlineOnly: false,
    transition: { from: ['open'], to: 'closed' },
  }),
  'payment.receive': define({
    name: 'payment.receive',
    entity: 'payment',
    kind: 'append',
    payloadSchema: paymentReceivePayload,
    permission: 'payment:receive',
    onlineOnly: false,
  }),
  'form_response.sign': define({
    name: 'form_response.sign',
    entity: 'form_response',
    kind: 'append',
    payloadSchema: formResponseSignPayload,
    permission: 'clinical_record:sign',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.completedAt }),
  }),
  'program_enrollment.enroll': define({
    name: 'program_enrollment.enroll',
    entity: 'program_enrollment',
    kind: 'create',
    payloadSchema: programEnrollPayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.enrolledAt }),
  }),
  'program_enrollment.discharge': define({
    name: 'program_enrollment.discharge',
    entity: 'program_enrollment',
    kind: 'update',
    payloadSchema: programDischargePayload,
    permission: 'clinical_record:create',
    onlineOnly: false,
    transition: { from: ['active'], to: 'discharged' },
  }),
  'break_glass.start': define({
    name: 'break_glass.start',
    entity: 'break_glass',
    kind: 'append',
    payloadSchema: breakGlassPayload,
    permission: 'clinical_record:break_glass',
    onlineOnly: false,
  }),
  'record_access.log': define({
    name: 'record_access.log',
    entity: 'record_access',
    kind: 'append',
    payloadSchema: recordAccessPayload,
    permission: 'patient:read',
    onlineOnly: false,
  }),
  'triage.record': define({
    name: 'triage.record',
    entity: 'triage',
    kind: 'append',
    payloadSchema: triageRecordPayload,
    permission: 'triage:create',
    onlineOnly: false,
    patientAct: (p) => ({ patientId: p.patientId, at: p.triagedAt }),
  }),
  'vital_sign.record': define({
    name: 'vital_sign.record',
    entity: 'vital_sign',
    kind: 'append',
    payloadSchema: vitalSignRecordPayload,
    permission: 'vital_sign:create',
    onlineOnly: false,
    check: (p) => {
      const result = checkVitalPlausibility(p);
      return result.ok ? null : result.reason;
    },
    patientAct: (p) => ({ patientId: p.patientId, at: p.measuredAt }),
  }),
  'stock_movement.record': define({
    name: 'stock_movement.record',
    entity: 'stock_movement',
    kind: 'append',
    payloadSchema: stockMovementRecordPayload,
    permission: 'stock:move',
    onlineOnly: false,
  }),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandPayload<N extends CommandName> = z.input<(typeof COMMANDS)[N]['payloadSchema']>;

/** Refusal code when a clinical act targets a patient already declared dead. */
export function deathRefusal(
  command: CommandDefinition,
  payload: unknown,
  patient: Record<string, unknown> | null | undefined,
): string | null {
  if (!command.patientAct || !patient) return null;
  const act = command.patientAct(payload as never);
  return blockedByDeath(patient.deceasedAt, act.at) ? 'PAT_DECEASED' : null;
}

/** The part of a payload that is merged into the entity, with the status a transition sets. */
export function mergeablePayload(
  command: CommandDefinition,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...payload };
  for (const key of command.transientFields ?? []) delete out[key];
  if (command.transition?.to) out.status = command.transition.to;
  return out;
}

/** False when a "first wins" status change no longer applies to the current state. */
export function transitionApplies(
  command: CommandDefinition,
  current: Record<string, unknown> | null | undefined,
): boolean {
  if (!command.transition || !current) return true;
  return command.transition.from.includes(String(current.status));
}

export function getCommand(name: string): CommandDefinition | undefined {
  return (COMMANDS as Record<string, CommandDefinition>)[name];
}
