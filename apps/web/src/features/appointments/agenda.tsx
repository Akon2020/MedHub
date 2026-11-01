'use client';

import {
  DEFAULT_DOCUMENT_TEMPLATE,
  addDays,
  daySlots,
  firstFreeSlot,
  formatNumber,
  formatTicketNumber,
  patientFullName,
  ticketCounterName,
  zonedDate,
  type CommandName,
  type Slot,
} from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Loader2,
  MoveRight,
  Search,
  UserX,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { isMerged } from '@/features/patients/patient-helpers';
import { localDay } from '@/features/visits/visit-helpers';

type Appointment = {
  id: string;
  patientId: string;
  patientName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  rejected: boolean;
  pending: boolean;
};

const nameOf = (entity: LocalEntity | null): string =>
  entity
    ? patientFullName({
        familyName: String(entity.data.familyName ?? ''),
        middleName: typeof entity.data.middleName === 'string' ? entity.data.middleName : null,
        givenName: typeof entity.data.givenName === 'string' ? entity.data.givenName : null,
      })
    : '';

/**
 * Day agenda of a practitioner or a service (docs/modules/rdv.md): slots from
 * the weekly hours and exceptions, booking, moving, arrival and absence, all
 * offline. A slot booked meanwhile by another workstation comes back rejected
 * after synchronisation and is shown here to be booked again.
 */
export function Agenda() {
  const t = useTranslations('appointments');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const { catalogs, dispatch, identity, device, nextCounter } = useRuntime();
  const snapshot = catalogs?.snapshot;
  const timeZone = snapshot?.timeZone ?? 'Africa/Kinshasa';
  const schedules = snapshot?.schedules ?? [];
  const exceptions = snapshot?.scheduleExceptions ?? [];
  const resources = [
    ...(snapshot?.staff ?? [])
      .filter((s) => schedules.some((x) => x.resourceId === s.id))
      .map((s) => ({
        id: s.id,
        kind: 'practitioner' as const,
        label: [s.title, s.displayName].filter(Boolean).join(' '),
      })),
    ...(snapshot?.departments ?? [])
      .filter((d) => schedules.some((x) => x.resourceId === d.id))
      .map((d) => ({ id: d.id, kind: 'department' as const, label: d.name })),
  ];
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const resource = resources.find((r) => r.id === resourceId) ?? resources[0];
  const [date, setDate] = useState(() => zonedDate(new Date(), timeZone));
  const [patientId, setPatientId] = useState(params.get('patient') ?? '');
  const [moving, setMoving] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const can = (key: string) => identity?.permissions.includes(key) ?? false;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { data } = useLocalQuery(
    async (store) => {
      const all = (await store.readEntities('appointment', true)).filter(
        (a) => a.data.resourceId === resource?.id,
      );
      const rows: Appointment[] = [];
      for (const a of all) {
        rows.push({
          id: a.id,
          patientId: String(a.data.patientId),
          patientName: nameOf(await store.readEntity('patient', String(a.data.patientId))),
          startsAt: String(a.data.startsAt),
          endsAt: String(a.data.endsAt),
          status: String(a.data.status),
          rejected: a.rejected === true,
          pending: a.version === 0,
        });
      }
      const selected = patientId ? await store.readEntity('patient', patientId) : null;
      const found =
        query.trim().length >= 2
          ? (await store.searchPatients(query.trim(), 8)).filter((e) => !isMerged(e))
          : [];
      return {
        rows,
        selected: selected ? { id: selected.id, name: nameOf(selected) } : null,
        found: found.map((e) => ({ id: e.id, name: nameOf(e), mrn: String(e.data.mrn ?? '') })),
      };
    },
    [resource?.id, patientId, query],
  );
  const rows = data?.rows ?? [];
  const active = rows.filter((r) => !r.rejected);
  const slots: Slot[] = resource
    ? daySlots({
        resourceId: resource.id,
        date,
        timeZone,
        schedules,
        exceptions,
        appointments: active,
      })
    : [];
  // A refused booking stays visible until the patient has another appointment ahead.
  const rejected = rows.filter(
    (r) =>
      r.rejected &&
      !active.some(
        (a) =>
          a.patientId === r.patientId &&
          (a.status === 'booked' || a.status === 'confirmed') &&
          Date.parse(a.startsAt) >= now,
      ),
  );

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage({ ok: true, text: done });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  function book(slot: Slot) {
    if (!resource) return;
    if (moving) {
      const target = moving;
      void run(async () => {
        await dispatch(
          'appointment.reschedule',
          { startsAt: slot.startsAt, endsAt: slot.endsAt },
          { entityId: target.id },
        );
        setMoving(null);
      }, t('moved'));
      return;
    }
    if (!patientId) return;
    void run(
      () =>
        dispatch('appointment.book', {
          patientId,
          resourceKind: resource.kind,
          resourceId: resource.id,
          appointmentTypeId: null,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        }),
      t('booked'),
    );
  }

  function mark(name: CommandName, appointment: Appointment) {
    void run(
      () => dispatch(name, { at: new Date().toISOString() } as never, { entityId: appointment.id }),
      t('saved'),
    );
  }

  /** Arrival from the agenda: the appointment, the visit and the queue ticket together. */
  function arrive(appointment: Appointment) {
    void run(async () => {
      const marked = await dispatch(
        'appointment.mark_arrived',
        { at: new Date().toISOString() },
        { entityId: appointment.id },
      );
      if (!can('encounter:create') || !device) return;
      const now = new Date();
      const department = resource?.kind === 'department' ? resource.id : null;
      const queue =
        snapshot?.queues?.find((q) => department && q.departmentId === department) ??
        snapshot?.queues?.[0];
      const visit = await dispatch(
        'encounter.open',
        {
          patientId: appointment.patientId,
          kind: 'outpatient',
          departmentId: department,
          practitionerId: resource?.kind === 'practitioner' ? resource.id : null,
          appointmentId: appointment.id,
          visitNumber: formatNumber(DEFAULT_DOCUMENT_TEMPLATE, {
            site: identity?.siteCode ?? 'SIT',
            device: device.deviceCode,
            year: now.getFullYear(),
            seq: await nextCounter(`visit:${now.getFullYear()}`),
          }),
          startedAt: now.toISOString(),
        },
        { dependsOn: [marked.opId] },
      );
      if (!queue) return;
      const seq = await nextCounter(ticketCounterName(queue.id, localDay(now)));
      await dispatch(
        'queue_ticket.issue',
        {
          queueId: queue.id,
          patientId: appointment.patientId,
          encounterId: visit.entityId,
          number: formatTicketNumber(queue.ticketPrefix, device.deviceCode, seq),
          issuedAt: now.toISOString(),
        },
        { dependsOn: [visit.opId] },
      );
    }, t('arrived'));
  }

  function cancel(event: FormEvent) {
    event.preventDefault();
    const target = cancelling;
    if (!target) return;
    void run(async () => {
      await dispatch(
        'appointment.cancel',
        { cancelReason: reason.trim() },
        { entityId: target.id },
      );
      setCancelling(null);
      setReason('');
    }, t('cancelled'));
  }

  function nextFree() {
    if (!resource) return;
    const slot = firstFreeSlot({
      resourceId: resource.id,
      from: date,
      days: 60,
      now: new Date(),
      timeZone,
      schedules,
      exceptions,
      appointments: active,
    });
    if (slot) setDate(zonedDate(new Date(slot.startsAt), timeZone));
    else setMessage({ ok: false, text: t('noFreeSlot') });
  }

  if (resources.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noAgenda')}</p>;
  }

  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', timeZone });
  const canBook = can('appointment:create');
  const canUpdate = can('appointment:update');

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 gap-1.5">
          <Label htmlFor="agenda-resource">{t('resource')}</Label>
          <NativeSelect
            id="agenda-resource"
            value={resource?.id ?? ''}
            onChange={(e) => setResourceId(e.target.value)}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('previousDay')}
            onClick={() => setDate(addDays(date, -1))}
          >
            <ChevronLeft />
          </Button>
          <div className="grid gap-1.5">
            <Label htmlFor="agenda-date">{t('date')}</Label>
            <Input
              id="agenda-date"
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('nextDay')}
            onClick={() => setDate(addDays(date, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button variant="secondary" onClick={nextFree}>
          {t('firstFree')}
        </Button>
      </div>

      {canBook && !moving && (
        <Card className="grid gap-3 p-4 text-sm">
          {data?.selected ? (
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{t('bookingFor')}</span>
              <span className="font-medium">{data.selected.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPatientId('');
                  router.replace('/app/rendez-vous');
                }}
              >
                <X />
                {t('changePatient')}
              </Button>
            </p>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="agenda-patient">{t('choosePatient')}</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="agenda-patient"
                  className="pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>
              {(data?.found ?? []).length > 0 && (
                <ul className="grid gap-1">
                  {data?.found.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-3 py-2 text-left hover:bg-muted"
                        onClick={() => {
                          setPatientId(p.id);
                          setQuery('');
                        }}
                      >
                        <span className="font-medium">{p.name}</span>{' '}
                        <span className="font-mono text-xs text-muted-foreground">{p.mrn}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {moving && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl bg-info-soft px-4 py-3 text-sm text-info">
          <MoveRight className="size-4" aria-hidden />
          {t('movingHint', { name: moving.patientName })}
          <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>
            {t('cancel')}
          </Button>
        </p>
      )}

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={cn(
            'rounded-lg px-3.5 py-2.5 text-sm',
            message.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {message.text}
        </p>
      )}

      {rejected.length > 0 && (
        <Card className="grid gap-2 bg-warning-soft p-4 text-sm">
          <p className="font-medium text-warning">{t('rejectedTitle')}</p>
          {rejected.map((r) => (
            <p key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {r.patientName} ·{' '}
                {format.dateTime(new Date(r.startsAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                })}
              </span>
              {canBook && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPatientId(r.patientId);
                    nextFree();
                  }}
                >
                  <CalendarPlus />
                  {t('rebook')}
                </Button>
              )}
            </p>
          ))}
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">
            {format.dateTime(new Date(`${date}T12:00:00Z`), {
              dateStyle: 'full',
              timeZone: 'UTC',
            })}
          </h2>
          <Badge variant="muted">{t('slotCount', { count: slots.length })}</Badge>
        </div>
        {slots.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('closed')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {slots.map((slot) => {
              const here = active.filter(
                (a) =>
                  Date.parse(a.startsAt) === Date.parse(slot.startsAt) && a.status !== 'cancelled',
              );
              const past = Date.parse(slot.startsAt) < now;
              return (
                <li key={slot.startsAt} className="grid gap-2 px-4 py-3 sm:grid-cols-[6rem_1fr]">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {time(slot.startsAt)}
                  </span>
                  <div className="grid gap-2">
                    {here.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {a.patientName || t('unknownPatient')}
                        </span>
                        <Badge
                          variant={
                            a.status === 'arrived'
                              ? 'success'
                              : a.status === 'no_show'
                                ? 'danger'
                                : 'info'
                          }
                        >
                          {t(`statuses.${a.status}`)}
                        </Badge>
                        {a.pending && <Badge variant="muted">{t('pending')}</Badge>}
                        {(a.status === 'booked' || a.status === 'confirmed') && (
                          <span className="flex flex-wrap gap-1">
                            {canUpdate && (
                              <Button size="sm" onClick={() => arrive(a)} disabled={busy}>
                                <DoorOpen />
                                {t('arrive')}
                              </Button>
                            )}
                            {canUpdate && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setMoving(a)}
                                disabled={busy}
                              >
                                <MoveRight />
                                {t('move')}
                              </Button>
                            )}
                            {canUpdate && past && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => mark('appointment.mark_no_show', a)}
                                disabled={busy}
                              >
                                <UserX />
                                {t('noShow')}
                              </Button>
                            )}
                            {can('appointment:cancel') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setCancelling(a)}
                                disabled={busy}
                              >
                                <X />
                                {t('cancelAppointment')}
                              </Button>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                    {cancelling && here.some((a) => a.id === cancelling.id) && (
                      <form onSubmit={cancel} className="flex flex-wrap items-end gap-2" noValidate>
                        <div className="grid min-w-56 flex-1 gap-1.5">
                          <Label htmlFor="cancel-reason">{t('cancelReason')}</Label>
                          <Input
                            id="cancel-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </div>
                        <Button
                          type="submit"
                          size="sm"
                          variant="destructive"
                          disabled={busy || reason.trim().length < 3}
                        >
                          {busy && <Loader2 className="animate-spin" />}
                          {t('confirmCancel')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelling(null)}
                        >
                          {t('cancel')}
                        </Button>
                      </form>
                    )}
                    {slot.free && !past && (canBook || moving) && (
                      <div>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || (!moving && !patientId)}
                          onClick={() => book(slot)}
                        >
                          <CalendarPlus />
                          {moving ? t('moveHere') : here.length > 0 ? t('overbook') : t('book')}
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
