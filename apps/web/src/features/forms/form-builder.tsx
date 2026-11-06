'use client';

import {
  checkDefinition,
  consultationGeneral,
  evaluateForm,
  FIELD_TYPES,
  FORM_STEPS,
  formDefinition,
  localized,
  type Answers,
  type FieldType,
  type FormContext,
  type FormDefinition,
  type FormField,
  type FormSection,
} from '@medhub/forms';
import { VITAL_SIGN_CODES } from '@medhub/shared';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useStepUp } from '@/features/auth/step-up';
import { FormRenderer } from './form-renderer';

type VersionView = {
  id: string;
  version: number;
  status: string;
  publishedAt: string | null;
  definition: Record<string, unknown>;
};
type FormView = {
  id: string;
  code: string;
  step: string;
  title: { fr: string; en?: string };
  versions: VersionView[];
};
type Overview = { forms: FormView[]; canDesign: boolean; canPublish: boolean };
type Issue = { fieldId: string | null; code: string };

const SAMPLES: Record<string, Omit<FormContext, 'now'>> = {
  woman: { birthDate: '1994-05-01', sex: 'F', pregnant: false, vitals: {} },
  man: { birthDate: '1970-09-15', sex: 'M', pregnant: false, vitals: {} },
  child: { birthDate: '2022-02-01', sex: 'M', pregnant: false, vitals: {} },
};

const EMPTY_FORM: FormDefinition = {
  schemaVersion: 1,
  code: 'nouveau_formulaire',
  title: { fr: 'Nouveau formulaire' },
  step: 'consultation',
  sections: [{ id: 'section_1', title: { fr: 'Section 1' }, fields: [] }],
};

const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
};
const opt = (v: string) => (v.trim() === '' ? undefined : v);
const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

/** Options typed one per line: "code | libellé | English label". */
function parseOptions(text: string): FormField['options'] {
  return text
    .split('\n')
    .map((l) => l.split('|').map((p) => p.trim()))
    .filter((p) => p[0])
    .map(([code = '', fr = '', en = '']) => ({
      code,
      label: en ? { fr: fr || code, en } : { fr: fr || code },
    }));
}
const optionsText = (options: FormField['options']) =>
  (options ?? []).map((o) => [o.code, o.label.fr, o.label.en ?? ''].join(' | ')).join('\n');

/**
 * Form builder (docs/modules/form.md, capacity 1): online screen. Sections and
 * fields are added and ordered without code, with a live preview from the
 * same engine as the workstations. Publishing freezes the version.
 */
export function FormBuilder() {
  const t = useTranslations('settings.forms');
  const tf = useTranslations('forms');
  const tErr = useTranslations('errors');
  const locale = useLocale();
  const online = useOnline();
  const { reloadCatalogs } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDefinition | null>(null);
  const [sample, setSample] = useState('woman');
  const [answers, setAnswers] = useState<Answers>({});
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [now] = useState(() => new Date());

  const describe = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      return tErr.has(code) ? tErr(code) : tErr('UNKNOWN');
    },
    [tErr],
  );

  const refresh = useCallback(async () => {
    try {
      setOverview(await apiFetch<Overview>('/api/v1/forms'));
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

  const current = overview?.forms.find((f) => f.id === definitionId) ?? null;
  const published = current?.versions.find((v) => v.status === 'published') ?? null;
  const previousParsed = published ? formDefinition.safeParse(published.definition) : null;
  const previous = previousParsed?.success ? previousParsed.data : null;
  const parsed = draft ? formDefinition.safeParse(draft) : null;
  const issues: Issue[] = parsed
    ? parsed.success
      ? checkDefinition(parsed.data, previous)
      : parsed.error.issues.map((i) => ({ fieldId: i.path.join('.'), code: i.message }))
    : [];
  const preview =
    parsed?.success && draft
      ? evaluateForm(parsed.data, answers, { ...(SAMPLES[sample] ?? SAMPLES.woman!), now })
      : null;

  function edit(form: FormView) {
    const latest = form.versions[0];
    const p = latest ? formDefinition.safeParse(latest.definition) : null;
    setDefinitionId(form.id);
    setDraft(p?.success ? p.data : null);
    setAnswers({});
    setServerIssues([]);
    setNotice(null);
  }

  function startNew(base: FormDefinition) {
    setDefinitionId(null);
    setDraft(structuredClone(base));
    setAnswers({});
    setServerIssues([]);
    setNotice(null);
  }

  const setSections = (sections: FormSection[]) => draft && setDraft({ ...draft, sections });
  const setSection = (si: number, patch: Partial<FormSection>) =>
    draft && setSections(draft.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const setField = (si: number, fi: number, patch: Partial<FormField>) =>
    draft &&
    setSection(si, {
      fields: (draft.sections[si]?.fields ?? []).map((f, i) =>
        i === fi ? ({ ...f, ...patch } as FormField) : f,
      ),
    });

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const out = await apiFetch<{ definitionId: string; version: number }>('/api/v1/forms', {
        method: 'POST',
        body: JSON.stringify({ definitionId, definition: draft }),
      });
      setDefinitionId(out.definitionId);
      setNotice(t('draftSaved', { version: out.version }));
      await refresh();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!definitionId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setServerIssues([]);
    try {
      const out = await guard(() =>
        apiFetch<{ version: number }>('/api/v1/forms/publish', {
          method: 'POST',
          body: JSON.stringify({ definitionId }),
        }),
      );
      setNotice(t('published', { version: out.version }));
      await refresh();
      await reloadCatalogs();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details.issues)) {
        setServerIssues(err.details.issues as Issue[]);
      }
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson() {
    try {
      const p = formDefinition.safeParse(JSON.parse(json));
      if (!p.success) return setError(tErr('FORM_INVALID'));
      startNew(p.data);
      setJson('');
    } catch {
      setError(tErr('FORM_INVALID'));
    }
  }

  if (!online && !overview) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!overview) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
    );
  }

  const canDesign = overview.canDesign;
  const allIssues = [...issues, ...serverIssues];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('library')}</CardTitle>
          <CardDescription>{t('libraryText')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {overview.forms.length === 0 && <p className="text-muted-foreground">{t('none')}</p>}
          <ul className="grid gap-2">
            {overview.forms.map((f) => {
              const latest = f.versions[0];
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => edit(f)}
                  >
                    {localized(f.title, locale)}
                  </button>
                  <span className="font-mono text-xs text-muted-foreground">{f.code}</span>
                  {latest && (
                    <Badge variant={latest.status === 'published' ? 'info' : 'muted'}>
                      {t(`status.${latest.status}`, { version: latest.version })}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
          {canDesign && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => startNew(EMPTY_FORM)}>
                <FilePlus2 />
                {t('new')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => startNew(consultationGeneral)}>
                <FilePlus2 />
                {t('fromTemplate', { name: localized(consultationGeneral.title, locale) })}
              </Button>
            </div>
          )}
          {canDesign && (
            <div className="grid gap-2">
              <Textarea
                aria-label={t('importJson')}
                placeholder={t('importJson')}
                rows={2}
                className="font-mono text-xs"
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-start"
                disabled={json.trim() === ''}
                onClick={importJson}
              >
                <Upload />
                {t('import')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {draft && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('editor')}</CardTitle>
              {published && (
                <CardDescription>
                  {t('editingNext', { version: published.version })}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="fb-code">{t('code')}</Label>
                  <Input
                    id="fb-code"
                    value={draft.code}
                    disabled={definitionId !== null}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="fb-step">{t('step')}</Label>
                  <NativeSelect
                    id="fb-step"
                    value={draft.step}
                    onChange={(e) =>
                      setDraft({ ...draft, step: e.target.value as FormDefinition['step'] })
                    }
                  >
                    {FORM_STEPS.map((s) => (
                      <option key={s} value={s}>
                        {t(`steps.${s}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Bilingual
                  id="fb-title"
                  label={t('formTitle')}
                  value={draft.title}
                  onChange={(title) => setDraft({ ...draft, title })}
                />
              </div>

              {draft.sections.map((section, si) => (
                <div key={si} className="grid gap-3 rounded-xl p-3 ring-1 ring-border">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="grid flex-1 gap-1.5">
                      <Label htmlFor={`fb-s${si}`}>{t('sectionTitle')}</Label>
                      <Input
                        id={`fb-s${si}`}
                        value={section.title.fr}
                        onChange={(e) =>
                          setSection(si, { title: { ...section.title, fr: e.target.value } })
                        }
                      />
                    </div>
                    <IconButtons
                      onUp={() => setSections(move(draft.sections, si, -1))}
                      onDown={() => setSections(move(draft.sections, si, 1))}
                      onRemove={() => setSections(draft.sections.filter((_, i) => i !== si))}
                      labels={{ up: t('up'), down: t('down'), remove: t('remove') }}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Plain
                      id={`fb-s${si}-id`}
                      label={t('id')}
                      value={section.id}
                      onChange={(v) => setSection(si, { id: v })}
                    />
                    <Plain
                      id={`fb-s${si}-vis`}
                      label={t('visibleIf')}
                      value={section.visibleIf ?? ''}
                      mono
                      onChange={(v) => setSection(si, { visibleIf: opt(v) })}
                    />
                  </div>
                  {section.fields.map((field, fi) => (
                    <FieldEditor
                      key={fi}
                      field={field}
                      onChange={(patch) => setField(si, fi, patch)}
                      onUp={() => setSection(si, { fields: move(section.fields, fi, -1) })}
                      onDown={() => setSection(si, { fields: move(section.fields, fi, 1) })}
                      onRemove={() =>
                        setSection(si, { fields: section.fields.filter((_, i) => i !== fi) })
                      }
                    />
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-self-start"
                    onClick={() =>
                      setSection(si, {
                        fields: [
                          ...section.fields,
                          {
                            id: `champ_${section.fields.length + 1}`,
                            type: 'text',
                            label: { fr: t('newField') },
                          },
                        ],
                      })
                    }
                  >
                    <Plus />
                    {t('addField')}
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                className="justify-self-start"
                onClick={() =>
                  setSections([
                    ...draft.sections,
                    {
                      id: `section_${draft.sections.length + 1}`,
                      title: { fr: `Section ${draft.sections.length + 1}` },
                      fields: [],
                    },
                  ])
                }
              >
                <Plus />
                {t('addSection')}
              </Button>

              {allIssues.length > 0 && (
                <ul className="max-h-48 overflow-auto rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                  {allIssues.map((i, n) => (
                    <li key={`${i.fieldId}-${i.code}-${n}`}>
                      {i.fieldId ? `${i.fieldId} : ` : ''}
                      {tf.has(`errors.${i.code}`) ? tf(`errors.${i.code}`) : i.code}
                    </li>
                  ))}
                </ul>
              )}
              {notice && (
                <p role="status" className="text-success">
                  {notice}
                </p>
              )}
              {error && (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {canDesign && (
                  <Button disabled={busy || !parsed?.success} onClick={() => void save()}>
                    {busy ? <Loader2 className="animate-spin" /> : <Save />}
                    {t('saveDraft')}
                  </Button>
                )}
                {overview.canPublish && (
                  <Button
                    variant="secondary"
                    disabled={
                      busy ||
                      issues.length > 0 ||
                      !current?.versions.some((v) => v.status === 'draft')
                    }
                    onClick={() => void publish()}
                  >
                    <Send />
                    {t('publish')}
                  </Button>
                )}
                <Button variant="ghost" onClick={exportJson}>
                  <Download />
                  {t('export')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('preview')}</CardTitle>
              <CardDescription>{t('previewText')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <NativeSelect
                aria-label={t('sample')}
                className="max-w-64"
                value={sample}
                onChange={(e) => setSample(e.target.value)}
              >
                {Object.keys(SAMPLES).map((k) => (
                  <option key={k} value={k}>
                    {t(`samples.${k}`)}
                  </option>
                ))}
              </NativeSelect>
              {preview && parsed?.success ? (
                <FormRenderer
                  definition={parsed.data}
                  answers={answers}
                  state={preview}
                  onChange={setAnswers}
                  showErrors
                />
              ) : (
                <p className="text-muted-foreground">{t('previewUnavailable')}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {dialog}
    </div>
  );
}

function FieldEditor({
  field,
  onChange,
  onUp,
  onDown,
  onRemove,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('settings.forms');
  const key = `fb-${field.id}`;
  const numeric = field.type === 'number' || field.type === 'scale' || field.type === 'vital';
  const choices = field.type === 'choice' || field.type === 'multi_choice';
  const [options, setOptions] = useState(() => optionsText(field.options));
  return (
    <details className="rounded-lg bg-muted/40 p-3" open={field.label.fr === t('newField')}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <span className="font-medium">{field.label.fr}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {field.id} · {t(`types.${field.type}`)}
        </span>
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Plain
          id={`${key}-id`}
          label={t('id')}
          value={field.id}
          onChange={(v) => onChange({ id: v })}
        />
        <div className="grid gap-1.5">
          <Label htmlFor={`${key}-type`}>{t('type')}</Label>
          <NativeSelect
            id={`${key}-type`}
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as FieldType })}
          >
            {FIELD_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`types.${ty}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Bilingual
          id={`${key}-label`}
          label={t('label')}
          value={field.label}
          onChange={(label) => onChange({ label })}
        />
        {field.type !== 'info' && field.type !== 'calculation' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={field.required === true}
              onChange={(e) => onChange({ required: e.target.checked || undefined })}
            />
            {t('required')}
          </label>
        )}
        <Plain
          id={`${key}-vis`}
          label={t('visibleIf')}
          value={field.visibleIf ?? ''}
          mono
          onChange={(v) => onChange({ visibleIf: opt(v) })}
        />
        {field.type !== 'info' && field.type !== 'calculation' && (
          <Plain
            id={`${key}-req`}
            label={t('requiredIf')}
            value={field.requiredIf ?? ''}
            mono
            onChange={(v) => onChange({ requiredIf: opt(v) })}
          />
        )}
        {field.type === 'calculation' && (
          <Plain
            id={`${key}-expr`}
            label={t('expression')}
            value={field.expression ?? ''}
            mono
            onChange={(v) => onChange({ expression: opt(v) })}
          />
        )}
        {field.type === 'vital' && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${key}-vital`}>{t('vital')}</Label>
            <NativeSelect
              id={`${key}-vital`}
              value={field.vital ?? ''}
              onChange={(e) =>
                onChange({ vital: (opt(e.target.value) as FormField['vital']) ?? undefined })
              }
            >
              <option value="">{t('choose')}</option>
              {VITAL_SIGN_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {(numeric || field.type === 'calculation') && (
          <>
            <Plain
              id={`${key}-unit`}
              label={t('unit')}
              value={field.unit ?? ''}
              onChange={(v) => onChange({ unit: opt(v) })}
            />
            <Plain
              id={`${key}-dec`}
              label={t('decimals')}
              value={field.decimals?.toString() ?? ''}
              onChange={(v) => onChange({ decimals: optNum(v) })}
            />
          </>
        )}
        {numeric && (
          <>
            <Plain
              id={`${key}-min`}
              label={t('min')}
              value={field.min?.toString() ?? ''}
              onChange={(v) => onChange({ min: optNum(v) })}
            />
            <Plain
              id={`${key}-max`}
              label={t('max')}
              value={field.max?.toString() ?? ''}
              onChange={(v) => onChange({ max: optNum(v) })}
            />
            <Plain
              id={`${key}-rmsg`}
              label={t('rangeMessage')}
              value={field.rangeMessage?.fr ?? ''}
              onChange={(v) => onChange({ rangeMessage: v.trim() ? { fr: v } : undefined })}
            />
          </>
        )}
        {choices && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${key}-opts`}>{t('options')}</Label>
            <Textarea
              id={`${key}-opts`}
              rows={4}
              className="font-mono text-xs"
              value={options}
              onChange={(e) => {
                setOptions(e.target.value);
                onChange({ options: parseOptions(e.target.value) });
              }}
            />
            <p className="text-xs text-muted-foreground">{t('optionsHint')}</p>
          </div>
        )}
        <Plain
          id={`${key}-help`}
          label={t('help')}
          value={field.help?.fr ?? ''}
          onChange={(v) => onChange({ help: v.trim() ? { fr: v } : undefined })}
        />
      </div>
      <div className="mt-3">
        <IconButtons
          onUp={onUp}
          onDown={onDown}
          onRemove={onRemove}
          labels={{ up: t('up'), down: t('down'), remove: t('remove') }}
        />
      </div>
    </details>
  );
}

function Plain({
  id,
  label,
  value,
  onChange,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className={mono ? 'font-mono text-xs' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Bilingual({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: { fr: string; en?: string };
  onChange: (value: { fr: string; en?: string }) => void;
}) {
  const t = useTranslations('settings.forms');
  return (
    <>
      <Plain
        id={`${id}-fr`}
        label={`${label} (${t('fr')})`}
        value={value.fr}
        onChange={(fr) => onChange({ ...value, fr })}
      />
      <Plain
        id={`${id}-en`}
        label={`${label} (${t('en')})`}
        value={value.en ?? ''}
        onChange={(en) => onChange(en.trim() ? { ...value, en } : { fr: value.fr })}
      />
    </>
  );
}

function IconButtons({
  onUp,
  onDown,
  onRemove,
  labels,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  labels: { up: string; down: string; remove: string };
}) {
  return (
    <div className="flex gap-1">
      <Button type="button" size="icon" variant="ghost" aria-label={labels.up} onClick={onUp}>
        <ArrowUp />
      </Button>
      <Button type="button" size="icon" variant="ghost" aria-label={labels.down} onClick={onDown}>
        <ArrowDown />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={labels.remove}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
