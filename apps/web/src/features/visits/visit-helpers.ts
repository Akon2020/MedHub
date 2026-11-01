import { compareTickets, type TicketPriority, type TicketStatus } from '@medhub/domain';
import type { LocalEntity } from '@medhub/sync/client';

export type TicketView = {
  id: string;
  queueId: string;
  patientId: string;
  encounterId: string | null;
  number: string;
  priority: TicketPriority;
  status: TicketStatus;
  issuedAt: string;
  calledAt: string | null;
  room: string | null;
  pending: boolean;
};

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Local calendar day (YYYY-MM-DD) of the workstation. */
export function localDay(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function toTicketView(entity: LocalEntity): TicketView {
  const d = entity.data;
  return {
    id: entity.id,
    queueId: s(d.queueId) ?? '',
    patientId: s(d.patientId) ?? '',
    encounterId: s(d.encounterId),
    number: s(d.number) ?? '',
    priority: (s(d.priority) ?? 'normal') as TicketPriority,
    status: (s(d.status) ?? 'waiting') as TicketStatus,
    issuedAt: s(d.issuedAt) ?? '',
    calledAt: s(d.calledAt),
    room: s(d.room),
    pending: entity.version === 0,
  };
}

/** Tickets issued today on this workstation's calendar, in queue order. */
export function todayTickets(entities: readonly LocalEntity[], now = new Date()): TicketView[] {
  const day = localDay(now);
  return entities
    .filter((e) => !e.rejected)
    .map(toTicketView)
    .filter((t) => t.issuedAt && localDay(new Date(t.issuedAt)) === day)
    .sort(compareTickets);
}
