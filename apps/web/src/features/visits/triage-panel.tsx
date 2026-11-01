'use client';

import {
  TICKET_PRIORITIES,
  formatTicketNumber,
  ticketCounterName,
  type TicketPriority,
} from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { ClipboardPlus, Loader2, Pencil } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { localDay, type TicketView } from './visit-helpers';

export type TriageView = {
  id: string;
  encounterId: string;
  priority: TicketPriority;
  chiefComplaint: string;
  notes: string | null;
  orientationQueueId: string | null;
  triagedAt: string;
};

/**
 * Triage of today's visit (docs/modules/rdv.md, capability 10), offline:
 * complaint, priority and orientation. Orienting the patient finishes the
 * current ticket and issues one in the next queue with the triage priority,
 * so nothing is typed twice. A correction supersedes the previous triage.
 */
export function TriagePanel({
  patientId,
  encounterId,
  triage,
  tickets,
}: {
  patientId: string;
  encounterId: string;
  triage: TriageView | null;
  tickets: TicketView[];
}) {
  const t = useTranslations('visits.triage');
  const tv = useTranslations('visits');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, catalogs, device, identity, nextCounter } = useRuntime();
  const queues = catalogs?.snapshot.queues ?? [];
  const [editing, setEditing] = useState(triage === null);
  const [complaint, setComplaint] = useState(triage?.chiefComplaint ?? '');
  const [priority, setPriority] = useState<TicketPriority>(triage?.priority ?? 'normal');
  const [notes, setNotes] = useState(triage?.notes ?? '');
  const [orientation, setOrientation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canTriage = identity?.permissions.includes('triage:create') ?? false;

  if (!canTriage && !triage) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const queue = queues.find((q) => q.id === orientation);
      const recorded = await dispatch('triage.record', {
        encounterId,
        patientId,
        priority,
        chiefComplaint: complaint.trim(),
        notes: notes.trim() || null,
        orientationQueueId: queue?.id ?? null,
        triagedAt: now.toISOString(),
        supersedesId: triage?.id ?? null,
      });
      if (queue) {
        for (const ticket of tickets) {
          if (
            ticket.queueId !== queue.id &&
            (ticket.status === 'called' || ticket.status === 'in_service')
          ) {
            await dispatch(
              'queue_ticket.complete',
              { completedAt: now.toISOString() },
              { entityId: ticket.id },
            );
          }
        }
        const seq = await nextCounter(ticketCounterName(queue.id, localDay(now)));
        await dispatch(
          'queue_ticket.issue',
          {
            queueId: queue.id,
            patientId,
            encounterId,
            number: formatTicketNumber(queue.ticketPrefix, device.deviceCode, seq),
            priority,
            issuedAt: now.toISOString(),
          },
          { dependsOn: [recorded.opId] },
        );
      }
      if (identity?.permissions.includes('encounter:update_status')) {
        await dispatch('encounter.update_status', { status: 'triaged' }, { entityId: encounterId });
      }
      setEditing(false);
      setOrientation('');
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
          <ClipboardPlus className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        {triage && !editing && canTriage && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil />
            {t('correct')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {triage && !editing && (
          <div className="grid gap-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant={triage.priority === 'emergency' ? 'danger' : 'info'}>
                {tv(`priorities.${triage.priority}`)}
              </Badge>
              <span className="font-medium">{triage.chiefComplaint}</span>
            </p>
            {triage.notes && <p className="text-muted-foreground">{triage.notes}</p>}
            <p className="text-xs text-muted-foreground">
              {format.dateTime(new Date(triage.triagedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {triage.orientationQueueId
                ? ` · ${t('orientedTo', {
                    queue: queues.find((q) => q.id === triage.orientationQueueId)?.name ?? '',
                  })}`
                : ''}
            </p>
          </div>
        )}
        {editing && canTriage && (
          <form onSubmit={submit} className="grid gap-3" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="triage-complaint">{t('complaint')}</Label>
              <Input
                id="triage-complaint"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="triage-priority">{t('priority')}</Label>
                <NativeSelect
                  id="triage-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tv(`priorities.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="triage-orientation">{t('orientation')}</Label>
                <NativeSelect
                  id="triage-orientation"
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value)}
                >
                  <option value="">{t('noOrientation')}</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="triage-notes">{t('notes')}</Label>
              <Textarea
                id="triage-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || complaint.trim().length < 2}>
                {busy && <Loader2 className="animate-spin" />}
                {t('save')}
              </Button>
              {triage && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
