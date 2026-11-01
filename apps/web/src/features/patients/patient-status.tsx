'use client';

import type { PatientDeathPayload } from '@medhub/domain';
import { AppError, PATIENT_SENSITIVITIES, type PatientSensitivity } from '@medhub/shared';
import { Flag, HeartOff, Loader2, Lock, Search, Star, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { isMerged, toPatientView, type PatientView } from './patient-helpers';

type Data = Record<string, unknown>;

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function deceasedAtOf(data: Data): string | null {
  return typeof data.deceasedAt === 'string' && data.deceasedAt !== '' ? data.deceasedAt : null;
}

/** Status badges shown next to the patient's name, in the record and in lists. */
export function PatientStatusBadges({ data }: { data: Data }) {
  const t = useTranslations('patient.status');
  const format = useFormatter();
  const deceasedAt = deceasedAtOf(data);
  return (
    <>
      {data.isProvisional === true && (
        <Badge variant="warning">
          {t(data.provisionalKind === 'newborn' ? 'newborn' : 'provisional')}
        </Badge>
      )}
      {typeof data.sensitivity === 'string' && data.sensitivity !== 'normal' && (
        <Badge variant="danger">
          <Lock className="size-3" aria-hidden />
          {t(`sensitivity.${data.sensitivity}`)}
        </Badge>
      )}
      {deceasedAt && (
        <Badge variant="muted">
          {t('deceased', { date: format.dateTime(new Date(deceasedAt), { dateStyle: 'medium' }) })}
        </Badge>
      )}
    </>
  );
}

/**
 * A provisional record is identified later (identity card) or recognised as a
 * patient already registered: the pair then goes to the duplicates queue,
 * where a user allowed to merge decides.
 */
export function ProvisionalPanel({ patientId }: { patientId: string }) {
  const t = useTranslations('patient.status');
  const tErr = useTranslations('errors');
  const { store } = useRuntime();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!store || query.trim().length < 2) return;
    const found = await store.searchPatients(query.trim(), 10);
    setResults(
      found
        .filter((e) => e.id !== patientId && !isMerged(e) && e.data.isProvisional !== true)
        .map((e) => toPatientView(e)),
    );
  }

  async function report(otherId: string) {
    setBusy(otherId);
    setMessage(null);
    try {
      await apiFetch('/api/v1/patients/duplicates/report', {
        method: 'POST',
        body: JSON.stringify({ patientId, otherId }),
      });
      setResults(null);
      setQuery('');
      setMessage({ ok: true, text: t('reported') });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-6 grid gap-3 rounded-xl bg-warning-soft p-4 text-sm">
      <p className="font-medium text-warning">{t('provisionalTitle')}</p>
      <p className="text-muted-foreground">{t('provisionalText')}</p>
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-1.5">
          <Label htmlFor="provisional-search">{t('knownSearch')}</Label>
          <Input
            id="provisional-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          <Search />
          {t('search')}
        </Button>
      </form>
      {results && results.length === 0 && <p className="text-muted-foreground">{t('noResult')}</p>}
      {results && results.length > 0 && (
        <ul className="grid gap-2">
          {results.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-card px-3 py-2 ring-1 ring-border"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">{p.mrn}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!online || busy !== null}
                onClick={() => void report(p.id)}
              >
                {busy === p.id ? <Loader2 className="animate-spin" /> : <Flag />}
                {t('report')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!online && <p className="text-xs text-muted-foreground">{t('reportOffline')}</p>}
      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-success' : 'text-danger'}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

/**
 * Declaring a death (dedicated permission) works offline; afterwards the record
 * refuses new clinical acts dated after the death. A declaration made by
 * mistake is withdrawn with a reason, never erased from the history.
 */
export function DeathPanel({ patientId, data }: { patientId: string; data: Data }) {
  const t = useTranslations('patient.status');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, identity } = useRuntime();
  const deceasedAt = deceasedAtOf(data);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(() => localDateTimeValue(new Date()));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!identity?.permissions.includes('patient:mark_deceased')) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: PatientDeathPayload = deceasedAt
        ? { deceasedAt: null, correctionReason: reason.trim() }
        : { deceasedAt: new Date(at).toISOString() };
      await dispatch('patient.mark_deceased', payload, { entityId: patientId });
      setOpen(false);
      setReason('');
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {deceasedAt ? <Undo2 /> : <HeartOff />}
        {deceasedAt ? t('withdraw') : t('declare')}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid max-w-sm gap-2 rounded-xl p-3 text-sm ring-1 ring-border"
      noValidate
    >
      {deceasedAt ? (
        <>
          <p>
            {t('withdrawText', {
              date: format.dateTime(new Date(deceasedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
          <Label htmlFor="death-reason">{t('withdrawReason')}</Label>
          <Input
            id="death-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoComplete="off"
          />
        </>
      ) : (
        <>
          <p>{t('declareText')}</p>
          <Label htmlFor="death-at">{t('declareAt')}</Label>
          <Input
            id="death-at"
            type="datetime-local"
            value={at}
            max={localDateTimeValue(new Date())}
            onChange={(e) => setAt(e.target.value)}
          />
        </>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={busy || (deceasedAt ? reason.trim().length < 3 : !at)}
        >
          {busy && <Loader2 className="animate-spin" />}
          {deceasedAt ? t('withdrawAction') : t('declareAction')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Marking a record (staff member, VIP, restricted) needs its own permission and
 * a reason. Users whose roles do not reach the new level lose the record from
 * their devices at the next synchronisation.
 */
export function SensitivityPanel({ patientId, data }: { patientId: string; data: Data }) {
  const t = useTranslations('patient.status');
  const tErr = useTranslations('errors');
  const { dispatch, identity } = useRuntime();
  const current = (
    typeof data.sensitivity === 'string' ? data.sensitivity : 'normal'
  ) as PatientSensitivity;
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<PatientSensitivity>(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!identity?.permissions.includes('patient:mark_sensitive')) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dispatch(
        'patient.set_sensitivity',
        { sensitivity: level, sensitivityReason: reason.trim() },
        { entityId: patientId },
      );
      setOpen(false);
      setReason('');
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setLevel(current);
          setOpen(true);
        }}
      >
        <Lock />
        {t('sensitivityAction')}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid max-w-sm gap-2 rounded-xl p-3 text-sm ring-1 ring-border"
      noValidate
    >
      <p>{t('sensitivityText')}</p>
      <Label htmlFor="sensitivity-level">{t('sensitivityLevel')}</Label>
      <NativeSelect
        id="sensitivity-level"
        value={level}
        onChange={(e) => setLevel(e.target.value as PatientSensitivity)}
      >
        {PATIENT_SENSITIVITIES.map((value) => (
          <option key={value} value={value}>
            {t(`sensitivity.${value}`)}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor="sensitivity-reason">{t('sensitivityReason')}</Label>
      <Input
        id="sensitivity-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoComplete="off"
      />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || level === current || reason.trim().length < 3}
        >
          {busy && <Loader2 className="animate-spin" />}
          {t('sensitivitySave')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Personal favourite: works offline and keeps the patient on the user's devices. */
export function FavoriteToggle({ patientId, favorite }: { patientId: string; favorite: boolean }) {
  const t = useTranslations('patient.status');
  const { dispatch } = useRuntime();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={favorite}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await dispatch('patient.favorite', {
            patientId,
            active: !favorite,
            at: new Date().toISOString(),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Star className={favorite ? 'fill-current text-warning' : undefined} />
      {favorite ? t('favoriteOn') : t('favoriteOff')}
    </Button>
  );
}
