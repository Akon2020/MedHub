'use client';

import {
  ALLERGY_CATEGORIES,
  ALLERGY_SEVERITIES,
  HISTORY_CATEGORIES,
  allergyStatus,
  groupDuplicates,
  type AllergyView,
  type CommandName,
} from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  HeartPulse,
  Loader2,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function toAllergyView(e: LocalEntity): AllergyView {
  const d = e.data;
  return {
    id: e.id,
    substance: s(d.substance),
    category: s(d.category) ?? 'other',
    severity: s(d.severity) ?? 'mild',
    reaction: s(d.reaction),
    certainty: s(d.certainty) ?? 'confirmed',
    noneKnown: d.noneKnown === true,
    notedAt: s(d.notedAt) ?? '',
    status: s(d.status) ?? 'active',
  };
}

export type ListRow = {
  id: string;
  label: string;
  detail: string | null;
  status: string;
  notedAt: string;
  pending: boolean;
};

function useCanWrite(): boolean {
  return useRuntime().identity?.permissions.includes('clinical_record:create') ?? false;
}

function useRun() {
  const tErr = useTranslations('errors');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(task: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Allergy alert under the patient's name (docs/07-ui-ux.md section 2): always in red. */
export function AllergyBanner({ rows }: { rows: AllergyView[] }) {
  const t = useTranslations('record.allergies');
  const format = useFormatter();
  const { allergies, noneKnownAt } = allergyStatus(rows);
  if (allergies.length > 0) {
    return (
      <p
        role="alert"
        className="mb-6 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
      >
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="font-semibold">{t('banner')}</span>
        {allergies.map((a) => (
          <Badge key={a.id} variant="danger">
            {a.substance}
            {a.severity === 'severe' || a.severity === 'life_threatening'
              ? ` · ${t(`severities.${a.severity}`)}`
              : ''}
          </Badge>
        ))}
      </p>
    );
  }
  return (
    <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
      <ShieldAlert className="size-4" aria-hidden />
      {noneKnownAt
        ? t('noneKnownOn', {
            date: format.dateTime(new Date(noneKnownAt), { dateStyle: 'medium' }),
          })
        : t('unknown')}
    </p>
  );
}

function RetractForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = useTranslations('record');
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason.trim());
      }}
    >
      <div className="grid min-w-48 flex-1 gap-1.5">
        <Label htmlFor="retract-reason">{t('retractReason')}</Label>
        <Input id="retract-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={busy || reason.trim().length < 3}
      >
        {t('retract')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </form>
  );
}

function ListCard({
  title,
  icon,
  rows,
  empty,
  retractCommand,
  extraAction,
  form,
}: {
  title: string;
  icon: ReactNode;
  rows: ListRow[];
  empty: string;
  retractCommand: CommandName;
  extraAction?: (row: ListRow) => ReactNode;
  form: (close: () => void) => ReactNode;
}) {
  const t = useTranslations('record');
  const format = useFormatter();
  const { dispatch } = useRuntime();
  const canWrite = useCanWrite();
  const { busy, error, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [retracting, setRetracting] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = rows.filter((r) => showAll || r.status === 'active');
  const hidden = rows.length - rows.filter((r) => r.status === 'active').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {canWrite && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus />
            {t('add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {adding && form(() => setAdding(false))}
        {visible.length === 0 && !adding && <p className="text-muted-foreground">{empty}</p>}
        <ul className="divide-y divide-border">
          {visible.map((row) => (
            <li key={row.id} className="grid gap-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'min-w-0 flex-1',
                    row.status === 'retracted' && 'text-muted-foreground line-through',
                  )}
                >
                  <span className="font-medium">{row.label}</span>
                  {row.detail && <span className="text-muted-foreground"> · {row.detail}</span>}
                </span>
                {row.status !== 'active' && (
                  <Badge variant="muted">{t(`statuses.${row.status}`)}</Badge>
                )}
                {row.pending && <Badge variant="muted">{t('pending')}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(row.notedAt), { dateStyle: 'medium' })}
                </span>
                {canWrite && row.status === 'active' && retracting !== row.id && (
                  <>
                    {extraAction?.(row)}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('retract')}
                      onClick={() => setRetracting(row.id)}
                    >
                      <X />
                    </Button>
                  </>
                )}
              </div>
              {retracting === row.id && (
                <RetractForm
                  busy={busy}
                  onCancel={() => setRetracting(null)}
                  onSubmit={(reason) =>
                    void run(() =>
                      dispatch(
                        retractCommand,
                        { retractReason: reason, retractedAt: new Date().toISOString() } as never,
                        { entityId: row.id },
                      ),
                    ).then((ok) => ok && setRetracting(null))
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? t('hideOld') : t('showOld', { count: hidden })}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AllergiesCard({ patientId, rows }: { patientId: string; rows: AllergyView[] }) {
  const t = useTranslations('record.allergies');
  const tr = useTranslations('record');
  const { dispatch } = useRuntime();
  const { busy, error, run } = useRun();
  const { noneKnownAt } = allergyStatus(rows);
  const list: ListRow[] = groupDuplicates(
    rows.filter((r) => !r.noneKnown),
    (r) => (r.substance ?? '').toLowerCase(),
  ).map((r) => ({
    id: r.id,
    label: r.substance ?? '',
    detail: [
      t(`severities.${r.severity}`),
      r.reaction,
      r.certainty === 'suspected' ? t('suspected') : null,
    ]
      .filter(Boolean)
      .join(' · '),
    status: r.status,
    notedAt: r.notedAt,
    pending: false,
  }));

  return (
    <ListCard
      title={t('title')}
      icon={<AlertTriangle className="size-4 text-danger" aria-hidden />}
      rows={list}
      empty={noneKnownAt ? t('noneKnown') : t('unknown')}
      retractCommand="allergy.retract"
      form={(close) => (
        <AllergyForm
          busy={busy}
          error={error}
          onCancel={close}
          onNoneKnown={
            list.some((r) => r.status === 'active')
              ? null
              : () =>
                  void run(() =>
                    dispatch('allergy.set_none_known', {
                      patientId,
                      notedAt: new Date().toISOString(),
                    }),
                  ).then((ok) => ok && close())
          }
          onSubmit={(values) =>
            void run(() =>
              dispatch('allergy.add', { patientId, ...values, notedAt: new Date().toISOString() }),
            ).then((ok) => ok && close())
          }
          labels={{ save: tr('save'), cancel: tr('cancel') }}
        />
      )}
    />
  );
}

function AllergyForm({
  busy,
  error,
  onSubmit,
  onCancel,
  onNoneKnown,
  labels,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (values: {
    substance: string;
    category: (typeof ALLERGY_CATEGORIES)[number];
    severity: (typeof ALLERGY_SEVERITIES)[number];
    reaction: string | null;
    certainty: 'suspected' | 'confirmed';
  }) => void;
  onCancel: () => void;
  onNoneKnown: (() => void) | null;
  labels: { save: string; cancel: string };
}) {
  const t = useTranslations('record.allergies');
  const [substance, setSubstance] = useState('');
  const [category, setCategory] = useState<(typeof ALLERGY_CATEGORIES)[number]>('drug');
  const [severity, setSeverity] = useState<(typeof ALLERGY_SEVERITIES)[number]>('moderate');
  const [reaction, setReaction] = useState('');
  const [suspected, setSuspected] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      substance: substance.trim(),
      category,
      severity,
      reaction: reaction.trim() || null,
      certainty: suspected ? 'suspected' : 'confirmed',
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-muted/50 p-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="allergy-substance">{t('substance')}</Label>
          <Input
            id="allergy-substance"
            value={substance}
            onChange={(e) => setSubstance(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="allergy-reaction">{t('reaction')}</Label>
          <Input
            id="allergy-reaction"
            value={reaction}
            onChange={(e) => setReaction(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="allergy-category">{t('category')}</Label>
          <NativeSelect
            id="allergy-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {ALLERGY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="allergy-severity">{t('severity')}</Label>
          <NativeSelect
            id="allergy-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
          >
            {ALLERGY_SEVERITIES.map((c) => (
              <option key={c} value={c}>
                {t(`severities.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={suspected}
          onChange={(e) => setSuspected(e.target.checked)}
        />
        {t('suspected')}
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || substance.trim().length < 2}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {labels.save}
        </Button>
        {onNoneKnown && (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onNoneKnown}>
            {t('setNoneKnown')}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}

function SimpleForm({
  fields,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  fields: {
    key: string;
    label: string;
    options?: { value: string; label: string }[];
    type?: string;
  }[];
  busy: boolean;
  error: string | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('record');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.options?.[0]?.value ?? ''])),
  );
  const first = fields[0]?.key ?? '';
  return (
    <form
      className="grid gap-3 rounded-xl bg-muted/50 p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="grid gap-1.5">
            <Label htmlFor={`field-${f.key}`}>{f.label}</Label>
            {f.options ? (
              <NativeSelect
                id={`field-${f.key}`}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id={`field-${f.key}`}
                type={f.type ?? 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || (values.label ?? values[first] ?? '').trim().length < 2}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function HistoryCard({ patientId, rows }: { patientId: string; rows: LocalEntity[] }) {
  const t = useTranslations('record.history');
  const { dispatch } = useRuntime();
  const { busy, error, run } = useRun();
  const list: ListRow[] = groupDuplicates(
    rows.map((r) => ({
      id: r.id,
      label: s(r.data.label) ?? '',
      detail: [
        t(`categories.${s(r.data.category) ?? 'other'}`),
        s(r.data.icd10),
        s(r.data.startDate),
      ]
        .filter(Boolean)
        .join(' · '),
      status: s(r.data.status) ?? 'active',
      notedAt: s(r.data.notedAt) ?? '',
      pending: r.version === 0,
    })),
    (r) => r.label.toLowerCase(),
  ).sort((a, b) => b.notedAt.localeCompare(a.notedAt));
  return (
    <ListCard
      title={t('title')}
      icon={<ClipboardList className="size-4 text-primary" aria-hidden />}
      rows={list}
      empty={t('empty')}
      retractCommand="medical_history.retract"
      form={(close) => (
        <SimpleForm
          busy={busy}
          error={error}
          onCancel={close}
          fields={[
            { key: 'label', label: t('label') },
            {
              key: 'category',
              label: t('category'),
              options: HISTORY_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) })),
            },
            { key: 'icd10', label: t('icd10') },
            { key: 'startDate', label: t('startDate'), type: 'date' },
          ]}
          onSubmit={(v) =>
            void run(() =>
              dispatch('medical_history.add', {
                patientId,
                category: v.category as (typeof HISTORY_CATEGORIES)[number],
                label: v.label ?? '',
                icd10: v.icd10?.trim() || null,
                startDate: v.startDate || null,
                notedAt: new Date().toISOString(),
              }),
            ).then((ok) => ok && close())
          }
        />
      )}
    />
  );
}

export function ProblemsCard({ patientId, rows }: { patientId: string; rows: LocalEntity[] }) {
  const t = useTranslations('record.problems');
  const { dispatch } = useRuntime();
  const { busy, error, run } = useRun();
  const list: ListRow[] = groupDuplicates(
    rows.map((r) => ({
      id: r.id,
      label: s(r.data.label) ?? '',
      detail: [s(r.data.icd10), s(r.data.onsetDate), s(r.data.resolvedDate)]
        .filter(Boolean)
        .join(' · '),
      status: s(r.data.status) ?? 'active',
      notedAt: s(r.data.notedAt) ?? '',
      pending: r.version === 0,
    })),
    (r) => r.label.toLowerCase(),
  ).sort((a, b) => b.notedAt.localeCompare(a.notedAt));
  return (
    <ListCard
      title={t('title')}
      icon={<HeartPulse className="size-4 text-primary" aria-hidden />}
      rows={list}
      empty={t('empty')}
      retractCommand="problem.retract"
      extraAction={(row) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() =>
              dispatch(
                'problem.resolve',
                { resolvedDate: new Date().toISOString().slice(0, 10) },
                { entityId: row.id },
              ),
            )
          }
        >
          <Check />
          {t('resolve')}
        </Button>
      )}
      form={(close) => (
        <SimpleForm
          busy={busy}
          error={error}
          onCancel={close}
          fields={[
            { key: 'label', label: t('label') },
            { key: 'icd10', label: t('icd10') },
            { key: 'onsetDate', label: t('onsetDate'), type: 'date' },
          ]}
          onSubmit={(v) =>
            void run(() =>
              dispatch('problem.add', {
                patientId,
                label: v.label ?? '',
                icd10: v.icd10?.trim() || null,
                onsetDate: v.onsetDate || null,
                notedAt: new Date().toISOString(),
              }),
            ).then((ok) => ok && close())
          }
        />
      )}
    />
  );
}
