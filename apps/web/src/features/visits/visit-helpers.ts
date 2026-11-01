import { compareTickets, type TicketPriority, type TicketStatus } from '@medhub/domain';
import type { LocalEntity } from '@medhub/sync/client';
import type { TriageView } from './triage-panel';

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

/** Today's visit still open for this patient, the most recent one first. */
export function openVisitOfToday(
  entities: readonly LocalEntity[],
  now = new Date(),
): string | null {
  const day = localDay(now);
  const open = entities
    .filter((e) => !e.rejected)
    .filter((e) => {
      const started = s(e.data.startedAt);
      const status = s(e.data.status);
      return (
        started !== null &&
        localDay(new Date(started)) === day &&
        status !== 'completed' &&
        status !== 'cancelled'
      );
    })
    .sort((a, b) => String(b.data.startedAt).localeCompare(String(a.data.startedAt)));
  return open[0]?.id ?? null;
}

/** Current triage of a visit: the active row (a correction supersedes the previous one). */
export function currentTriage(
  entities: readonly LocalEntity[],
  encounterId: string,
): TriageView | null {
  const active = entities
    .filter(
      (e) => !e.rejected && e.data.encounterId === encounterId && e.data.status !== 'superseded',
    )
    .sort((a, b) => String(b.data.triagedAt).localeCompare(String(a.data.triagedAt)));
  const row = active[0];
  if (!row) return null;
  return {
    id: row.id,
    encounterId,
    priority: (s(row.data.priority) ?? 'normal') as TicketPriority,
    chiefComplaint: s(row.data.chiefComplaint) ?? '',
    notes: s(row.data.notes),
    orientationQueueId: s(row.data.orientationQueueId),
    triagedAt: s(row.data.triagedAt) ?? '',
  };
}
