'use client';

import type { ResourceKind } from '@medhub/domain';
import { CalendarClock, Check, ListOrdered, Loader2, Plus, Trash2, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { useStepUp } from '@/features/auth/step-up';

type Queue = {
  id: string;
  code: string;
  name: string;
  ticketPrefix: string;
  siteId: string;
  departmentId: string | null;
  isActive: boolean;
};
type AppointmentType = {
  id: string;
  code: string;
  name: string;
  durationMin: number;
  color: string;
  departmentId: string | null;
  isActive: boolean;
};
type Slot = {
  weekday: number;
  startTime: string;
  endTime: string;
  slotMin: number;
  overbookMax: number;
};
type Schedule = Slot & { resourceKind: string; resourceId: string };
type ScheduleException = {
  id: string;
  resourceId: string;
  date: string;
  kind: 'closed' | 'extra';
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
};
type Config = {
  queues: Queue[];
  appointmentTypes: AppointmentType[];
  schedules: Schedule[];
  exceptions: ScheduleException[];
  practitioners: { id: string; displayName: string; title: string | null }[];
  sites: { id: string; name: string }[];
  departments: { id: string; siteId: string; name: string }[];
  canEdit: boolean;
};

const KNOWN_ERRORS = new Set([
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
  'VALIDATION_FAILED',
  'RDV_CODE_TAKEN',
]);
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Online configuration of the RDV module: queues and their ticket prefix,
 * appointment types, weekly agendas and their exceptions. Devices receive it
 * with their catalogs.
 */
export function RdvSettings() {
  const t = useTranslations('settings.rdv');
  const ts = useTranslations('settings');
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError
        ? ts(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`)
        : ts('errors.NETWORK'),
    [ts],
  );

  const refresh = useCallback(async () => {
    try {
      setConfig(await apiFetch<Config>('/api/v1/schedules'));
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [describe]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  const send = useCallback(
    async (path: string, body: unknown): Promise<boolean> => {
      setError(null);
      setNotice(null);
      try {
        await guard(() => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }));
        setNotice(t('saved'));
        await refresh();
        return true;
      } catch (err) {
        setError(describe(err));
        return false;
      }
    },
    [guard, refresh, describe, t],
  );

  if (!online && !config) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{ts('offline')}</p>
      </div>
    );
  }
  if (!config) {
    return error ? (
      <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }

  return (
    <div className="grid gap-6">
      {dialog}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {notice}
        </p>
      )}
      <QueuesCard config={config} send={send} />
      <TypesCard config={config} send={send} />
      <AgendaCard config={config} send={send} />
    </div>
  );
}

type Send = (path: string, body: unknown) => Promise<boolean>;

function QueuesCard({ config, send }: { config: Config; send: Send }) {
  const t = useTranslations('settings.rdv');
  const empty = {
    id: null as string | null,
    code: '',
    name: '',
    ticketPrefix: '',
    siteId: config.sites[0]?.id ?? '',
    departmentId: '',
    isActive: true,
  };
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const siteName = (id: string) => config.sites.find((s) => s.id === id)?.name ?? '';
  const departmentName = (id: string | null) =>
    config.departments.find((d) => d.id === id)?.name ?? '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await send('/api/v1/queues', {
      ...draft,
      departmentId: draft.departmentId || null,
    });
    setBusy(false);
    if (ok) setDraft(empty);
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListOrdered className="size-4 text-primary" aria-hidden />
            {t('queues.title')}
          </CardTitle>
          <CardDescription className="mt-1">{t('queues.subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {config.queues.length === 0 ? (
          <p className="text-muted-foreground">{t('queues.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {config.queues.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="grid size-9 place-items-center rounded-lg bg-accent font-mono font-semibold text-primary">
                  {q.ticketPrefix}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{q.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[q.code, siteName(q.siteId), departmentName(q.departmentId)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {!q.isActive && <Badge variant="muted">{t('inactive')}</Badge>}
                {config.canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft({ ...q, departmentId: q.departmentId ?? '' })}
                  >
                    {t('edit')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {config.canEdit && (
          <form onSubmit={submit} className="grid gap-3 rounded-xl bg-muted/50 p-3" noValidate>
            <p className="font-medium">{draft.id ? t('queues.editTitle') : t('queues.newTitle')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('fields.name')} id="queue-name">
                <Input
                  id="queue-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label={t('fields.code')} id="queue-code">
                <Input
                  id="queue-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('fields.prefix')} id="queue-prefix">
                <Input
                  id="queue-prefix"
                  maxLength={3}
                  value={draft.ticketPrefix}
                  onChange={(e) =>
                    setDraft({ ...draft, ticketPrefix: e.target.value.toUpperCase() })
                  }
                />
              </Field>
              <Field label={t('fields.site')} id="queue-site">
                <NativeSelect
                  id="queue-site"
                  value={draft.siteId}
                  onChange={(e) => setDraft({ ...draft, siteId: e.target.value })}
                >
                  {config.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('fields.department')} id="queue-department">
                <NativeSelect
                  id="queue-department"
                  value={draft.departmentId}
                  onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}
                >
                  <option value="">{t('none')}</option>
                  {config.departments
                    .filter((d) => d.siteId === draft.siteId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <label className="flex items-center gap-2 self-end pb-3">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                />
                {t('fields.active')}
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || draft.name.trim().length < 2 || !draft.ticketPrefix}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t('save')}
              </Button>
              {draft.id && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(empty)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function TypesCard({ config, send }: { config: Config; send: Send }) {
  const t = useTranslations('settings.rdv');
  const empty = {
    id: null as string | null,
    code: '',
    name: '',
    durationMin: '15',
    color: '#0f6b6b',
    departmentId: '',
    isActive: true,
  };
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await send('/api/v1/appointment-types', {
      ...draft,
      durationMin: Number(draft.durationMin),
      departmentId: draft.departmentId || null,
    });
    setBusy(false);
    if (ok) setDraft(empty);
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('types.title')}</CardTitle>
          <CardDescription className="mt-1">{t('types.subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {config.appointmentTypes.length === 0 ? (
          <p className="text-muted-foreground">{t('types.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {config.appointmentTypes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: a.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {a.code} · {t('types.minutes', { count: a.durationMin })}
                  </span>
                </span>
                {!a.isActive && <Badge variant="muted">{t('inactive')}</Badge>}
                {config.canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        ...a,
                        durationMin: String(a.durationMin),
                        departmentId: a.departmentId ?? '',
                      })
                    }
                  >
                    {t('edit')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {config.canEdit && (
          <form onSubmit={submit} className="grid gap-3 rounded-xl bg-muted/50 p-3" noValidate>
            <p className="font-medium">{draft.id ? t('types.editTitle') : t('types.newTitle')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('fields.name')} id="type-name">
                <Input
                  id="type-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label={t('fields.code')} id="type-code">
                <Input
                  id="type-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('fields.duration')} id="type-duration">
                <Input
                  id="type-duration"
                  inputMode="numeric"
                  value={draft.durationMin}
                  onChange={(e) =>
                    setDraft({ ...draft, durationMin: e.target.value.replace(/\D/g, '') })
                  }
                />
              </Field>
              <Field label={t('fields.department')} id="type-department">
                <NativeSelect
                  id="type-department"
                  value={draft.departmentId}
                  onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}
                >
                  <option value="">{t('none')}</option>
                  {config.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('fields.color')} id="type-color">
                <Input
                  id="type-color"
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-3">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                />
                {t('fields.active')}
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || draft.name.trim().length < 2}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t('save')}
              </Button>
              {draft.id && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(empty)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function AgendaCard({ config, send }: { config: Config; send: Send }) {
  const t = useTranslations('settings.rdv');
  const format = useFormatter();
  const resources = [
    ...config.practitioners.map((p) => ({
      kind: 'practitioner' as ResourceKind,
      id: p.id,
      label: [p.title, p.displayName].filter(Boolean).join(' '),
    })),
    ...config.departments.map((d) => ({
      kind: 'department' as ResourceKind,
      id: d.id,
      label: d.name,
    })),
  ];
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const resource = resources.find((r) => r.id === resourceId);
  const current = config.schedules
    .filter((s) => s.resourceId === resourceId)
    .map(({ weekday, startTime, endTime, slotMin, overbookMax }) => ({
      weekday,
      startTime,
      endTime,
      slotMin,
      overbookMax,
    }));
  const [slots, setSlots] = useState<Slot[]>(current);
  const [loadedFor, setLoadedFor] = useState(resourceId);
  if (loadedFor !== resourceId) {
    setLoadedFor(resourceId);
    setSlots(current);
  }
  const [busy, setBusy] = useState(false);
  const [exception, setException] = useState({
    date: '',
    kind: 'closed' as 'closed' | 'extra',
    startTime: '',
    endTime: '',
    slotMin: '15',
    reason: '',
  });
  const exceptions = config.exceptions.filter((e) => e.resourceId === resourceId);
  const dirty = JSON.stringify(slots) !== JSON.stringify(current);
  const weekday = (n: number) =>
    format.dateTime(new Date(Date.UTC(2024, 0, n)), { weekday: 'long', timeZone: 'UTC' });

  const setSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function saveSlots() {
    if (!resource) return;
    setBusy(true);
    await send('/api/v1/schedules', {
      resourceKind: resource.kind,
      resourceId: resource.id,
      slots,
    });
    setBusy(false);
  }

  async function addException(event: FormEvent) {
    event.preventDefault();
    if (!resource) return;
    setBusy(true);
    const hours = exception.startTime && exception.endTime;
    const ok = await send('/api/v1/schedules/exceptions', {
      resourceKind: resource.kind,
      resourceId: resource.id,
      date: exception.date,
      kind: exception.kind,
      startTime: hours ? exception.startTime : null,
      endTime: hours ? exception.endTime : null,
      slotMin: exception.kind === 'extra' ? Number(exception.slotMin) : null,
      reason: exception.reason || null,
    });
    setBusy(false);
    if (ok) setException({ ...exception, date: '', reason: '' });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" aria-hidden />
            {t('agenda.title')}
          </CardTitle>
          <CardDescription className="mt-1">{t('agenda.subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <Field label={t('agenda.resource')} id="agenda-resource">
          <NativeSelect
            id="agenda-resource"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            <optgroup label={t('agenda.practitioners')}>
              {resources
                .filter((r) => r.kind === 'practitioner')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t('agenda.departments')}>
              {resources
                .filter((r) => r.kind === 'department')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </optgroup>
          </NativeSelect>
        </Field>

        <div className="grid gap-2">
          <p className="font-medium">{t('agenda.weekly')}</p>
          {slots.length === 0 && <p className="text-muted-foreground">{t('agenda.noSlot')}</p>}
          {slots.map((slot, i) => (
            <div
              key={i}
              className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]"
            >
              <Field label={t('fields.weekday')} id={`slot-day-${i}`}>
                <NativeSelect
                  id={`slot-day-${i}`}
                  value={slot.weekday}
                  disabled={!config.canEdit}
                  onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {weekday(d)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('fields.start')} id={`slot-start-${i}`}>
                <Input
                  id={`slot-start-${i}`}
                  type="time"
                  value={slot.startTime}
                  disabled={!config.canEdit}
                  onChange={(e) => setSlot(i, { startTime: e.target.value })}
                />
              </Field>
              <Field label={t('fields.end')} id={`slot-end-${i}`}>
                <Input
                  id={`slot-end-${i}`}
                  type="time"
                  value={slot.endTime}
                  disabled={!config.canEdit}
                  onChange={(e) => setSlot(i, { endTime: e.target.value })}
                />
              </Field>
              <Field label={t('fields.slotMin')} id={`slot-min-${i}`}>
                <Input
                  id={`slot-min-${i}`}
                  inputMode="numeric"
                  value={slot.slotMin}
                  disabled={!config.canEdit}
                  onChange={(e) =>
                    setSlot(i, { slotMin: Number(e.target.value.replace(/\D/g, '')) || 0 })
                  }
                />
              </Field>
              <Field label={t('fields.overbook')} id={`slot-over-${i}`}>
                <Input
                  id={`slot-over-${i}`}
                  inputMode="numeric"
                  value={slot.overbookMax}
                  disabled={!config.canEdit}
                  onChange={(e) =>
                    setSlot(i, { overbookMax: Number(e.target.value.replace(/\D/g, '')) || 0 })
                  }
                />
              </Field>
              {config.canEdit && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('agenda.removeSlot')}
                  onClick={() => setSlots((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {config.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setSlots((list) => [
                    ...list,
                    {
                      weekday: 1,
                      startTime: '08:00',
                      endTime: '12:00',
                      slotMin: 15,
                      overbookMax: 0,
                    },
                  ])
                }
              >
                <Plus />
                {t('agenda.addSlot')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || !dirty || !resource}
                onClick={() => void saveSlots()}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t('agenda.saveWeekly')}
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <p className="font-medium">{t('agenda.exceptions')}</p>
          {exceptions.length === 0 ? (
            <p className="text-muted-foreground">{t('agenda.noException')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {exceptions.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Badge variant={e.kind === 'closed' ? 'warning' : 'info'}>
                    {t(`agenda.kinds.${e.kind}`)}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    {format.dateTime(new Date(`${e.date}T00:00:00Z`), {
                      dateStyle: 'full',
                      timeZone: 'UTC',
                    })}
                    {e.startTime && e.endTime
                      ? ` · ${t('agenda.hours', { start: e.startTime, end: e.endTime })}`
                      : ''}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </span>
                  {config.canEdit && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('agenda.removeException')}
                      onClick={() => void send('/api/v1/schedules/exceptions/remove', { id: e.id })}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {config.canEdit && (
            <form
              onSubmit={addException}
              className="grid grid-cols-2 items-end gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-6"
              noValidate
            >
              <Field label={t('fields.date')} id="exception-date">
                <Input
                  id="exception-date"
                  type="date"
                  value={exception.date}
                  onChange={(e) => setException({ ...exception, date: e.target.value })}
                />
              </Field>
              <Field label={t('fields.kind')} id="exception-kind">
                <NativeSelect
                  id="exception-kind"
                  value={exception.kind}
                  onChange={(e) =>
                    setException({ ...exception, kind: e.target.value as 'closed' | 'extra' })
                  }
                >
                  <option value="closed">{t('agenda.kinds.closed')}</option>
                  <option value="extra">{t('agenda.kinds.extra')}</option>
                </NativeSelect>
              </Field>
              <Field label={t('fields.start')} id="exception-start">
                <Input
                  id="exception-start"
                  type="time"
                  value={exception.startTime}
                  onChange={(e) => setException({ ...exception, startTime: e.target.value })}
                />
              </Field>
              <Field label={t('fields.end')} id="exception-end">
                <Input
                  id="exception-end"
                  type="time"
                  value={exception.endTime}
                  onChange={(e) => setException({ ...exception, endTime: e.target.value })}
                />
              </Field>
              <Field label={t('fields.reason')} id="exception-reason">
                <Input
                  id="exception-reason"
                  value={exception.reason}
                  onChange={(e) => setException({ ...exception, reason: e.target.value })}
                />
              </Field>
              <Button type="submit" size="sm" disabled={busy || !exception.date || !resource}>
                <Plus />
                {t('agenda.addException')}
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
