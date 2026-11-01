'use client';

import { MARITAL_STATUSES, type PatientUpdatePayload } from '@medhub/domain';
import { AppError, SEXES } from '@medhub/shared';
import { Check, History, Loader2, Pencil, UserRound } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';

type Data = Record<string, unknown>;
type Address = { province: string; city: string; commune: string; quarter: string; street: string };
type Contact = { name: string; relation: string; phone: string };

const ADDRESS_KEYS = ['province', 'city', 'commune', 'quarter', 'street'] as const;
const TEXT_KEYS = [
  'familyName',
  'middleName',
  'givenName',
  'phone',
  'occupation',
  'nationality',
  'language',
  'fatherName',
  'motherName',
] as const;

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function draftOf(d: Data) {
  const address = obj(d.address);
  const contact = obj(d.contact);
  return {
    ...Object.fromEntries(TEXT_KEYS.map((k) => [k, text(d[k])])),
    sex: text(d.sex) || 'U',
    birthDate: text(d.birthDate),
    birthDateEstimated: d.birthDateEstimated === true,
    maritalStatus: text(d.maritalStatus),
    address: Object.fromEntries(ADDRESS_KEYS.map((k) => [k, text(address[k])])) as Address,
    contact: {
      name: text(contact.name),
      relation: text(contact.relation),
      phone: text(contact.phone),
    } as Contact,
  } as Record<(typeof TEXT_KEYS)[number], string> & {
    sex: string;
    birthDate: string;
    birthDateEstimated: boolean;
    maritalStatus: string;
    address: Address;
    contact: Contact;
  };
}

type Draft = ReturnType<typeof draftOf>;

/** Payload values as stored: empty text and empty groups become null. */
function normalized(draft: Draft): Data {
  const blank = (v: string) => (v.trim() === '' ? null : v.trim());
  const group = (g: Record<string, string>) =>
    Object.values(g).every((v) => v.trim() === '')
      ? null
      : Object.fromEntries(Object.entries(g).map(([k, v]) => [k, blank(v)]));
  return {
    ...Object.fromEntries(TEXT_KEYS.map((k) => [k, blank(draft[k])])),
    familyName: draft.familyName.trim(),
    sex: draft.sex,
    birthDate: blank(draft.birthDate),
    birthDateEstimated: draft.birthDateEstimated,
    maritalStatus: blank(draft.maritalStatus),
    address: group(draft.address),
    contact: group(draft.contact),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Identity of the patient, completed after the quick registration. Editing
 * works offline: only the changed fields are sent, merged field by field on
 * the server (scenario P2).
 */
export function IdentityCard({ patientId, data }: { patientId: string; data: Data }) {
  const t = useTranslations('patient.identityCard');
  const tp = useTranslations('patients');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, catalogs } = useRuntime();
  const provinces = catalogs?.snapshot.provinces ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(data));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const provisional = data.isProvisional === true;
  const [identified, setIdentified] = useState(true);
  const current = draftOf(data);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const before = normalized(current);
    const after = normalized(draft);
    const changes: Data = Object.fromEntries(
      Object.entries(after).filter(([k, v]) => !same(before[k], v)),
    );
    if (provisional && identified) changes.isProvisional = false;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await dispatch('patient.update', changes as PatientUpdatePayload, { entityId: patientId });
      setEditing(false);
      setMessage({ ok: true, text: t('saved') });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  const address = ADDRESS_KEYS.map((k) => current.address[k])
    .filter(Boolean)
    .reverse()
    .join(', ');
  const contact = [current.contact.name, current.contact.relation, current.contact.phone]
    .filter(Boolean)
    .join(' · ');
  const rows: [string, string][] = [
    [
      t('fields.birthDate'),
      current.birthDate
        ? current.birthDateEstimated
          ? t('estimatedYear', { year: current.birthDate.slice(0, 4) })
          : format.dateTime(new Date(`${current.birthDate}T00:00:00Z`), {
              dateStyle: 'long',
              timeZone: 'UTC',
            })
        : '',
    ],
    [t('fields.phone'), current.phone],
    [t('fields.address'), address],
    [t('fields.occupation'), current.occupation],
    [t('fields.maritalStatus'), current.maritalStatus ? t(`marital.${current.maritalStatus}`) : ''],
    [t('fields.nationality'), current.nationality],
    [t('fields.language'), current.language],
    [t('fields.fatherName'), current.fatherName],
    [t('fields.motherName'), current.motherName],
    [t('fields.contact'), contact],
  ];

  const field = (
    key: (typeof TEXT_KEYS)[number],
    extra: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`identity-${key}`}>{t(`fields.${key}`)}</Label>
      <Input
        id={`identity-${key}`}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        {...extra}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(draftOf(data));
              setMessage(null);
              setIdentified(true);
              setEditing(true);
            }}
          >
            <Pencil />
            {provisional ? t('identify') : t('edit')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={message.ok ? 'text-success' : 'text-danger'}
          >
            {message.text}
          </p>
        )}
        {editing ? (
          <form onSubmit={submit} className="grid gap-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-3">
              {field('familyName')}
              {field('middleName')}
              {field('givenName')}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="identity-sex">{t('fields.sex')}</Label>
                <NativeSelect
                  id="identity-sex"
                  value={draft.sex}
                  onChange={(e) => set('sex', e.target.value)}
                >
                  {SEXES.map((s) => (
                    <option key={s} value={s}>
                      {tp(`sex.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="identity-birthDate">{t('fields.birthDate')}</Label>
                <Input
                  id="identity-birthDate"
                  type="date"
                  value={draft.birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => set('birthDate', e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-2.5">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={draft.birthDateEstimated}
                  onChange={(e) => set('birthDateEstimated', e.target.checked)}
                />
                {t('fields.birthDateEstimated')}
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('phone', { type: 'tel', inputMode: 'tel' })}
              {field('occupation')}
              <div className="grid gap-1.5">
                <Label htmlFor="identity-maritalStatus">{t('fields.maritalStatus')}</Label>
                <NativeSelect
                  id="identity-maritalStatus"
                  value={draft.maritalStatus}
                  onChange={(e) => set('maritalStatus', e.target.value)}
                >
                  <option value="">{t('none')}</option>
                  {MARITAL_STATUSES.map((m) => (
                    <option key={m} value={m}>
                      {t(`marital.${m}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {field('nationality')}
              {field('language')}
              {field('fatherName')}
              {field('motherName')}
            </div>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">{t('fields.address')}</legend>
              {ADDRESS_KEYS.map((k) => (
                <div key={k} className="grid gap-1.5">
                  <Label htmlFor={`identity-address-${k}`}>{t(`address.${k}`)}</Label>
                  {k === 'province' && provinces.length > 0 ? (
                    <NativeSelect
                      id="identity-address-province"
                      value={draft.address.province}
                      onChange={(e) =>
                        set('address', { ...draft.address, province: e.target.value })
                      }
                    >
                      <option value="">{t('none')}</option>
                      {provinces.map((p) => (
                        <option key={p.code} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      id={`identity-address-${k}`}
                      value={draft.address[k]}
                      onChange={(e) => set('address', { ...draft.address, [k]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-sm font-medium">{t('fields.contact')}</legend>
              {(['name', 'relation', 'phone'] as const).map((k) => (
                <div key={k} className="grid gap-1.5">
                  <Label htmlFor={`identity-contact-${k}`}>{t(`contact.${k}`)}</Label>
                  <Input
                    id={`identity-contact-${k}`}
                    value={draft.contact[k]}
                    onChange={(e) => set('contact', { ...draft.contact, [k]: e.target.value })}
                  />
                </div>
              ))}
            </fieldset>
            {provisional && (
              <label className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={identified}
                  onChange={(e) => setIdentified(e.target.checked)}
                />
                <span>{t('identifiedConfirm')}</span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || draft.familyName.trim() === ''}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t('save')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('offlineHint')}</p>
          </form>
        ) : (
          <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2.5">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value || <span className="text-muted-foreground">·</span>}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

type Change = {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  source: string;
  changedAt: string;
  changedBy: string | null;
  device: string | null;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function display(
  value: unknown,
  labels: { yes: string; no: string; instant: (iso: string) => string },
): string {
  if (value === null || value === undefined || value === '') return '·';
  if (typeof value === 'boolean') return value ? labels.yes : labels.no;
  if (typeof value === 'string' && ISO_INSTANT.test(value)) return labels.instant(value);
  if (typeof value === 'object') {
    return (
      Object.values(value as Record<string, unknown>)
        .filter((v) => typeof v === 'string' && v)
        .join(', ') || '·'
    );
  }
  return String(value);
}

/** Field-by-field history, read online on demand (each reading is logged). */
export function FieldHistory({ patientId }: { patientId: string }) {
  const t = useTranslations('patient.identityCard');
  const format = useFormatter();
  const online = useOnline();
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const labels = {
    yes: t('yes'),
    no: t('no'),
    instant: (iso: string) =>
      format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }),
  };

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setChanges(
        (await apiFetch<{ changes: Change[] }>(`/api/v1/patients/history?id=${patientId}`)).changes,
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NOT_FOUND'
          ? t('historyNotSynced')
          : t('historyError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" aria-hidden />
          {t('historyTitle')}
        </CardTitle>
        {changes === null && (
          <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void load()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('historyShow')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {changes === null ? (
          <p className="text-muted-foreground">{online ? t('historyHint') : t('historyOffline')}</p>
        ) : changes.length === 0 ? (
          <p className="text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {changes.map((c) => (
              <li key={c.id} className="grid gap-1 py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {t.has(`fields.${c.field}`) ? t(`fields.${c.field}`) : c.field}
                  </span>
                  {c.source !== 'sync' && <Badge variant="muted">{t(`sources.${c.source}`)}</Badge>}
                </span>
                <span>
                  <span className="text-muted-foreground line-through">
                    {display(c.oldValue, labels)}
                  </span>
                  {' → '}
                  {display(c.newValue, labels)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(c.changedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {c.changedBy ? ` · ${c.changedBy}` : ''}
                  {c.device ? ` · ${t('device', { code: c.device })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
