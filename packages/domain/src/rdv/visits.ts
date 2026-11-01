import { z } from 'zod';

/** Visits (encounters) and waiting-queue tickets (docs/modules/rdv.md, capabilities 6 to 9). */
export const ENCOUNTER_KINDS = [
  'outpatient',
  'emergency',
  'inpatient',
  'day_care',
  'teleconsult',
  'lab_only',
  'pharmacy_only',
] as const;
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];

export const ENCOUNTER_STATUSES = [
  'planned',
  'arrived',
  'triaged',
  'in_consultation',
  'waiting_results',
  'completed',
  'cancelled',
] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export const TICKET_PRIORITIES = ['emergency', 'elderly', 'pregnant', 'child', 'normal'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ['waiting', 'called', 'in_service', 'done', 'left'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const encounterOpenPayload = z.object({
  patientId: z.uuid(),
  kind: z.enum(ENCOUNTER_KINDS),
  departmentId: z.uuid().nullish(),
  practitionerId: z.uuid().nullish(),
  appointmentId: z.uuid().nullish(),
  visitNumber: z.string().trim().min(1).max(40),
  startedAt: z.iso.datetime(),
  status: z.literal('arrived').default('arrived'),
});
export type EncounterOpenPayload = z.infer<typeof encounterOpenPayload>;

export const encounterStatusPayload = z.object({
  status: z.enum(['triaged', 'in_consultation', 'waiting_results']),
});

export const encounterClosePayload = z.object({
  status: z.enum(['completed', 'cancelled']),
  endedAt: z.iso.datetime(),
});

export const ticketIssuePayload = z.object({
  queueId: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullish(),
  number: z.string().trim().min(1).max(24),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  issuedAt: z.iso.datetime(),
  status: z.literal('waiting').default('waiting'),
});
export type TicketIssuePayload = z.infer<typeof ticketIssuePayload>;

export const ticketCallPayload = z.object({
  calledAt: z.iso.datetime(),
  room: z.string().trim().max(40).nullish(),
});
export const ticketStartPayload = z.object({ serviceStartedAt: z.iso.datetime() });
export const ticketCompletePayload = z.object({ completedAt: z.iso.datetime() });
export const ticketLeftPayload = z.object({ leftAt: z.iso.datetime() });

/** Statuses from which a visit may still change. */
export const OPEN_ENCOUNTER_STATUSES = [
  'arrived',
  'triaged',
  'in_consultation',
  'waiting_results',
] as const;

/**
 * Status changes of a ticket, "first wins": a change whose starting status no
 * longer holds (the ticket was already called by another device) is recorded
 * in the operation log but leaves the ticket as it is.
 */
export const TICKET_TRANSITIONS = {
  'queue_ticket.call': { from: ['waiting'], to: 'called' },
  'queue_ticket.start_service': { from: ['waiting', 'called'], to: 'in_service' },
  'queue_ticket.complete': { from: ['called', 'in_service'], to: 'done' },
  'queue_ticket.mark_left': { from: ['waiting', 'called'], to: 'left' },
} as const satisfies Record<string, { from: readonly TicketStatus[]; to: TicketStatus }>;

/**
 * Ticket number readable at a glance and unique without network: queue prefix,
 * workstation code, number of the day on that workstation (docs/02 section 10).
 */
export function formatTicketNumber(prefix: string, deviceCode: string, seq: number): string {
  return `${prefix}-${deviceCode}-${String(seq).padStart(3, '0')}`;
}

/** Counter name: one series per queue, per workstation and per local day. */
export function ticketCounterName(queueId: string, localDate: string): string {
  return `ticket:${queueId}:${localDate}`;
}

const PRIORITY_RANK: Record<TicketPriority, number> = {
  emergency: 0,
  elderly: 1,
  pregnant: 1,
  child: 1,
  normal: 2,
};

/** Queue order: an emergency always first, then priority, then arrival time. */
export function compareTickets(
  a: { priority: string; issuedAt: string; id: string },
  b: { priority: string; issuedAt: string; id: string },
): number {
  const rank = (p: string) => PRIORITY_RANK[p as TicketPriority] ?? PRIORITY_RANK.normal;
  return (
    rank(a.priority) - rank(b.priority) ||
    a.issuedAt.localeCompare(b.issuedAt) ||
    a.id.localeCompare(b.id)
  );
}

/** Minutes waited since the ticket was issued. */
export function waitedMinutes(issuedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(issuedAt)) / 60_000));
}
