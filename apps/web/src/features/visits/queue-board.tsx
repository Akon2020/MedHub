'use client';

import { patientFullName, waitedMinutes, type CommandName } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { Check, LogOut, Megaphone, MonitorPlay, Play } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { todayTickets, type TicketView } from './visit-helpers';

const QUEUE_KEY = 'medhub.queue';
const ROOM_KEY = 'medhub.room';

function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: the choice simply is not kept.
  }
}

type Row = TicketView & { patientName: string };

/**
 * Queue of the day for one service (docs/modules/rdv.md, capability 7). Works
 * offline on the local copy; calls from other workstations arrive with the
 * synchronisation, and a ticket already called elsewhere keeps its first call.
 */
export function QueueBoard() {
  const t = useTranslations('visits.board');
  const tv = useTranslations('visits');
  const tErr = useTranslations('errors');
  const { catalogs, dispatch, identity } = useRuntime();
  const queues = catalogs?.snapshot.queues ?? [];
  const [queueId, setQueueId] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const current = queues.find((q) => q.id === queueId) ?? queues[0];
  const canCall = identity?.permissions.includes('queue:call') ?? false;

  useEffect(() => {
    // The workstation's last queue and room are read once the page runs in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueId(remembered(QUEUE_KEY));
    setRoom(remembered(ROOM_KEY));
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { data } = useLocalQuery(
    async (store) => {
      if (!current) return [];
      const tickets = todayTickets(await store.readEntities('queue_ticket')).filter(
        (x) => x.queueId === current.id,
      );
      const rows: Row[] = [];
      for (const ticket of tickets) {
        const patient = await store.readEntity('patient', ticket.patientId);
        const d = patient?.data ?? {};
        rows.push({
          ...ticket,
          patientName: patient
            ? patientFullName({
                familyName: String(d.familyName ?? ''),
                middleName: typeof d.middleName === 'string' ? d.middleName : null,
                givenName: typeof d.givenName === 'string' ? d.givenName : null,
              })
            : '',
        });
      }
      return rows;
    },
    [current?.id],
  );
  const rows = data ?? [];

  async function act(name: CommandName, ticket: Row) {
    setError(null);
    const at = new Date().toISOString();
    const payloads: Partial<Record<CommandName, Record<string, unknown>>> = {
      'queue_ticket.call': { calledAt: at, room: room.trim() || null },
      'queue_ticket.start_service': { serviceStartedAt: at },
      'queue_ticket.complete': { completedAt: at },
      'queue_ticket.mark_left': { leftAt: at },
    };
    try {
      await dispatch(name, payloads[name] as never, { entityId: ticket.id });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    }
  }

  if (queues.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noQueue')}</p>;
  }

  const sections: { key: string; statuses: string[] }[] = [
    { key: 'waiting', statuses: ['waiting'] },
    { key: 'called', statuses: ['called', 'in_service'] },
    { key: 'finished', statuses: ['done', 'left'] },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 gap-1.5">
          <Label htmlFor="board-queue">{t('queue')}</Label>
          <NativeSelect
            id="board-queue"
            value={current?.id ?? ''}
            onChange={(e) => {
              setQueueId(e.target.value);
              remember(QUEUE_KEY, e.target.value);
            }}
          >
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid w-44 gap-1.5">
          <Label htmlFor="board-room">{t('room')}</Label>
          <Input
            id="board-room"
            value={room}
            placeholder={t('roomPlaceholder')}
            onChange={(e) => {
              setRoom(e.target.value);
              remember(ROOM_KEY, e.target.value);
            }}
          />
        </div>
        {current && (
          <Button variant="secondary" asChild>
            <Link href={`/app/ecran-appel?queue=${current.id}`}>
              <MonitorPlay />
              {t('callScreen')}
            </Link>
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {sections.map((section) => {
        const list = rows.filter((r) => section.statuses.includes(r.status));
        if (section.key === 'finished' && list.length === 0) return null;
        return (
          <Card key={section.key}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-semibold">{t(`sections.${section.key}`)}</h2>
              <Badge variant="muted">{list.length}</Badge>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {list.map((row) => (
                  <li
                    key={row.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 px-4 py-3',
                      row.priority === 'emergency' && 'bg-danger-soft/40',
                    )}
                  >
                    <span className="w-28 font-mono text-lg font-semibold text-primary">
                      {row.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/app/patients/fiche?id=${row.patientId}`}
                        className="block truncate font-medium hover:text-primary"
                      >
                        {row.patientName || t('unknownPatient')}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {row.status === 'waiting'
                          ? t('waited', { minutes: waitedMinutes(row.issuedAt, now) })
                          : tv(`statuses.${row.status}`)}
                        {row.room ? ` · ${row.room}` : ''}
                      </span>
                    </span>
                    {row.priority !== 'normal' && (
                      <Badge variant={row.priority === 'emergency' ? 'danger' : 'warning'}>
                        {tv(`priorities.${row.priority}`)}
                      </Badge>
                    )}
                    {canCall && (
                      <span className="flex flex-wrap gap-1.5">
                        {row.status === 'waiting' && (
                          <Button size="sm" onClick={() => void act('queue_ticket.call', row)}>
                            <Megaphone />
                            {t('call')}
                          </Button>
                        )}
                        {(row.status === 'waiting' || row.status === 'called') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void act('queue_ticket.start_service', row)}
                          >
                            <Play />
                            {t('start')}
                          </Button>
                        )}
                        {(row.status === 'called' || row.status === 'in_service') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void act('queue_ticket.complete', row)}
                          >
                            <Check />
                            {t('complete')}
                          </Button>
                        )}
                        {(row.status === 'waiting' || row.status === 'called') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void act('queue_ticket.mark_left', row)}
                          >
                            <LogOut />
                            {t('left')}
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
