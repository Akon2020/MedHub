'use client';

import {
  DEFAULT_DOCUMENT_TEMPLATE,
  ENCOUNTER_KINDS,
  TICKET_PRIORITIES,
  formatNumber,
  formatTicketNumber,
  ticketCounterName,
  type EncounterKind,
  type TicketPriority,
} from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { DoorOpen, Loader2, Ticket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { localDay, todayTickets, type TicketView } from './visit-helpers';

/** Kinds a front desk opens at arrival; the others come with their modules. */
const ARRIVAL_KINDS: readonly EncounterKind[] = ['outpatient', 'emergency'];

/**
 * Arrival of a patient (docs/07-ui-ux.md 5.1): the visit and the queue ticket
 * are created together, offline, in one action. The ticket number embeds the
 * workstation code so that two devices never print the same number.
 */
export function ArrivalPanel({ patientId, deceased }: { patientId: string; deceased: boolean }) {
  const t = useTranslations('visits.arrival');
  const tv = useTranslations('visits');
  const tErr = useTranslations('errors');
  const { dispatch, catalogs, device, identity, nextCounter } = useRuntime();
  const queues = catalogs?.snapshot.queues ?? [];
  const departments = (catalogs?.snapshot.departments ?? []).filter((d) => d.isActive);
  const [kind, setKind] = useState<EncounterKind>('outpatient');
  const [queueId, setQueueId] = useState(queues[0]?.id ?? '');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOpen = identity?.permissions.includes('encounter:create') ?? false;

  const { data: tickets } = useLocalQuery(
    async (store) => todayTickets(await store.readEntitiesByPatient('queue_ticket', patientId)),
    [patientId],
  );
  const active = (tickets ?? []).filter((x) => x.status === 'waiting' || x.status === 'called');

  if (!canOpen && active.length === 0) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const queue = queues.find((q) => q.id === queueId);
    if (!queue || !device) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const visitSeq = await nextCounter(`visit:${now.getFullYear()}`);
      const visitNumber = formatNumber(DEFAULT_DOCUMENT_TEMPLATE, {
        site: identity?.siteCode ?? 'SIT',
        device: device.deviceCode,
        year: now.getFullYear(),
        seq: visitSeq,
      });
      const visit = await dispatch('encounter.open', {
        patientId,
        kind,
        departmentId: queue.departmentId,
        visitNumber,
        startedAt: now.toISOString(),
      });
      const seq = await nextCounter(ticketCounterName(queue.id, localDay(now)));
      await dispatch(
        'queue_ticket.issue',
        {
          queueId: queue.id,
          patientId,
          encounterId: visit.entityId,
          number: formatTicketNumber(queue.ticketPrefix, device.deviceCode, seq),
          // An emergency visit always goes first in the queue.
          priority: kind === 'emergency' ? 'emergency' : priority,
          issuedAt: now.toISOString(),
        },
        { dependsOn: [visit.opId] },
      );
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DoorOpen className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {active.map((ticket) => (
          <ActiveTicket key={ticket.id} ticket={ticket} />
        ))}
        {canOpen && active.length === 0 && queues.length === 0 && (
          <p className="text-muted-foreground">{t('noQueue')}</p>
        )}
        {canOpen && active.length === 0 && queues.length > 0 && !deceased && (
          <form onSubmit={submit} className="grid gap-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="arrival-kind">{t('kind')}</Label>
                <NativeSelect
                  id="arrival-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as EncounterKind)}
                >
                  {ENCOUNTER_KINDS.filter((k) => ARRIVAL_KINDS.includes(k)).map((k) => (
                    <option key={k} value={k}>
                      {tv(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="arrival-queue">{t('queue')}</Label>
                <NativeSelect
                  id="arrival-queue"
                  value={queueId}
                  onChange={(e) => setQueueId(e.target.value)}
                >
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                      {q.departmentId
                        ? ` · ${departments.find((d) => d.id === q.departmentId)?.name ?? ''}`
                        : ''}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="arrival-priority">{t('priority')}</Label>
                <NativeSelect
                  id="arrival-priority"
                  value={kind === 'emergency' ? 'emergency' : priority}
                  disabled={kind === 'emergency'}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tv(`priorities.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy || !queueId}>
                {busy ? <Loader2 className="animate-spin" /> : <Ticket />}
                {t('submit')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
          </form>
        )}
        {deceased && active.length === 0 && (
          <p className="text-muted-foreground">{t('deceased')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveTicket({ ticket }: { ticket: TicketView }) {
  const t = useTranslations('visits');
  const { catalogs } = useRuntime();
  const queue = catalogs?.snapshot.queues?.find((q) => q.id === ticket.queueId);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-accent/60 p-4">
      <span className="font-mono text-2xl font-semibold tracking-wide text-primary">
        {ticket.number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{queue?.name ?? ''}</span>
        <span className="block text-xs text-muted-foreground">
          {t(`priorities.${ticket.priority}`)}
          {ticket.room ? ` · ${ticket.room}` : ''}
        </span>
      </span>
      <Badge variant={ticket.status === 'called' ? 'success' : 'info'}>
        {t(`statuses.${ticket.status}`)}
      </Badge>
    </div>
  );
}
