'use client';

import { checkVitalPlausibility, DEFAULT_VITAL_SIGN_DEFINITIONS } from '@medhub/domain';
import {
  allFields,
  evaluateForm,
  formDefinition,
  localized,
  vitalAnswers,
  type Answers,
  type FieldError,
  type FormContext,
  type FormDefinition,
  type FormStep,
} from '@medhub/forms';
import { AppError, type VitalSignCode } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { ClipboardList, FileSignature, Loader2, Save } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { answerText, FormRenderer } from './form-renderer';

type Version = {
  versionId: string;
  definitionId: string;
  version: number;
  status: 'published' | 'archived';
  definition: FormDefinition;
};
const DRAFT_EVERY_MS = 5_000;

/** Form versions of the catalog snapshot, parsed once. */
export function useFormVersions(): Version[] {
  const { catalogs } = useRuntime();
  const raw = catalogs?.snapshot.forms;
  return useMemo(
    () =>
      (raw ?? []).flatMap((v) => {
        const parsed = formDefinition.safeParse(v.definition);
        return parsed.success ? [{ ...v, definition: parsed.data }] : [];
      }),
    [raw],
  );
}

/**
 * Forms of one step for a patient (docs/modules/form.md): filled offline from
 * the published version, autosaved as an encrypted local draft, recorded as a
 * response that keeps its version. Bound vital fields create the measurement.
 */
export function FormsPanel({
  step,
  patientId,
  encounterId,
  context,
  responses,
}: {
  step: FormStep;
  patientId: string;
  encounterId: string | null;
  context: Omit<FormContext, 'now'>;
  responses: LocalEntity[];
}) {
  const t = useTranslations('forms');
  const tErr = useTranslations('errors');
  const locale = useLocale();
  const format = useFormatter();
  const { store, dispatch, identity, catalogs } = useRuntime();
  const versions = useFormVersions();
  const [open, setOpen] = useState<Version | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [extraErrors, setExtraErrors] = useState<Record<string, FieldError>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [correcting, setCorrecting] = useState<LocalEntity | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const loadedKey = useRef<string | null>(null);
  const canRecord = identity?.permissions.includes('clinical_record:create') ?? false;
  const canSign = identity?.permissions.includes('clinical_record:sign') ?? false;
  const vitalDefinitions = catalogs?.snapshot.vitalDefinitions ?? DEFAULT_VITAL_SIGN_DEFINITIONS;

  const available = useMemo(
    () => versions.filter((v) => v.status === 'published' && v.definition.step === step),
    [versions, step],
  );
  const draftKey = open ? `form:${open.versionId}:${patientId}:${encounterId ?? 'none'}` : null;

  useEffect(() => {
    if (!store || !draftKey || correcting || loadedKey.current === draftKey) return;
    loadedKey.current = draftKey;
    void store.loadDraft<Answers>(draftKey).then((draft) => {
      // Restoring the draft of an interrupted entry is the purpose of this effect.
      if (draft) setAnswers(draft);
    });
  }, [store, draftKey, correcting]);

  useEffect(() => {
    if (!store || !draftKey || correcting) return;
    const timer = setInterval(() => {
      const empty = Object.values(answers).every((v) => v === null || v === '' || v === undefined);
      void (empty ? store.deleteDraft(draftKey) : store.saveDraft(draftKey, answers));
    }, DRAFT_EVERY_MS);
    return () => clearInterval(timer);
  }, [store, draftKey, answers, correcting]);

  const state = open ? evaluateForm(open.definition, answers, { ...context, now }) : null;

  function start(version: Version, from?: LocalEntity) {
    setOpen(version);
    setCorrecting(from ?? null);
    setAnswers(from ? ((from.data.data ?? {}) as Answers) : {});
    setReason('');
    setShowErrors(false);
    setExtraErrors({});
    setMessage(null);
    setNow(new Date());
    loadedKey.current = null;
  }

  function close() {
    setOpen(null);
    setCorrecting(null);
    setAnswers({});
  }

  async function save(sign: boolean) {
    if (!open || !state) return;
    setShowErrors(true);
    setMessage(null);
    if (!state.complete) return;
    const vitals = vitalAnswers(open.definition, state.values);
    const implausible: Record<string, FieldError> = {};
    for (const v of vitals) {
      const check = checkVitalPlausibility(
        { code: v.code as VitalSignCode, value: v.value, plausibilityOverrideReason: null },
        vitalDefinitions as typeof DEFAULT_VITAL_SIGN_DEFINITIONS,
      );
      if (!check.ok) implausible[v.fieldId] = { code: check.reason };
    }
    setExtraErrors(implausible);
    if (Object.keys(implausible).length > 0) return;

    setBusy(true);
    try {
      const at = new Date().toISOString();
      const before = (correcting?.data.data ?? {}) as Answers;
      for (const v of vitals) {
        // A correction only records the measurements that changed.
        if (correcting && before[v.fieldId] === v.value) continue;
        await dispatch('vital_sign.record', {
          patientId,
          encounterId,
          code: v.code as VitalSignCode,
          value: v.value,
          unit: vitalDefinitions.find((d) => d.code === v.code)?.unit ?? '',
          measuredAt: at,
        });
      }
      await dispatch(sign ? 'form_response.sign' : 'form_response.complete', {
        patientId,
        encounterId,
        formVersionId: open.versionId,
        formCode: open.definition.code,
        data: state.values,
        completedAt: at,
        supersedesId: correcting?.id ?? null,
        correctionReason: correcting ? reason.trim() : null,
      });
      if (draftKey) await store?.deleteDraft(draftKey);
      setMessage({ ok: true, text: sign ? t('signed') : t('saved') });
      close();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  const shown = responses
    .filter((r) => !r.rejected)
    .sort((a, b) => String(b.data.completedAt).localeCompare(String(a.data.completedAt)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {!open && canRecord && (
          <div className="flex flex-wrap gap-2">
            {available.length === 0 && <p className="text-muted-foreground">{t('noForm')}</p>}
            {available.map((v) => (
              <Button key={v.versionId} size="sm" variant="secondary" onClick={() => start(v)}>
                {localized(v.definition.title, locale)}
              </Button>
            ))}
          </div>
        )}
        {open && state && (
          <div className="grid gap-4 rounded-xl p-3 ring-1 ring-border">
            <p className="font-medium">
              {localized(open.definition.title, locale)}{' '}
              <span className="text-xs text-muted-foreground">
                {t('version', { version: open.version })}
              </span>
            </p>
            <FormRenderer
              definition={open.definition}
              answers={answers}
              state={{ ...state, errors: { ...state.errors, ...extraErrors } }}
              onChange={(next) => {
                setAnswers(next);
                setExtraErrors({});
              }}
              showErrors={showErrors}
            />
            {correcting && (
              <div className="grid gap-1.5">
                <Label htmlFor="form-reason">{t('correctionReason')}</Label>
                <Input
                  id="form-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={busy || (correcting !== null && reason.trim().length < 3)}
                onClick={() => void save(false)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {t('save')}
              </Button>
              {canSign && (
                <Button
                  disabled={busy || (correcting !== null && reason.trim().length < 3)}
                  onClick={() => void save(true)}
                >
                  <FileSignature />
                  {t('sign')}
                </Button>
              )}
              <Button variant="ghost" onClick={close}>
                {t('cancel')}
              </Button>
              {showErrors && state && !state.complete && (
                <span role="alert" className="text-xs text-danger">
                  {t('incomplete')}
                </span>
              )}
            </div>
          </div>
        )}
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={message.ok ? 'text-success' : 'text-danger'}
          >
            {message.text}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="grid gap-3">
            {shown.map((r) => {
              const version = versions.find((v) => v.versionId === r.data.formVersionId);
              const data = (r.data.data ?? {}) as Answers;
              const superseded = r.data.status === 'superseded';
              return (
                <li key={r.id} className="grid gap-1 rounded-xl p-3 ring-1 ring-border">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {version
                        ? localized(version.definition.title, locale)
                        : String(r.data.formCode)}
                    </span>
                    {version && t('version', { version: version.version })}
                    <span>
                      {format.dateTime(new Date(String(r.data.completedAt)), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <Badge variant={r.data.state === 'signed' ? 'info' : 'muted'}>
                      {t(`state.${r.data.state === 'signed' ? 'signed' : 'completed'}`)}
                    </Badge>
                    {superseded && <Badge variant="muted">{t('superseded')}</Badge>}
                    {r.version === 0 && <Badge variant="muted">{t('pending')}</Badge>}
                  </p>
                  {version ? (
                    <dl className={superseded ? 'text-muted-foreground line-through' : ''}>
                      {allFields(version.definition)
                        .filter((f) => data[f.id] !== undefined && data[f.id] !== null)
                        .map((f) => (
                          <div key={f.id} className="flex flex-wrap gap-1">
                            <dt className="font-medium">{localized(f.label, locale)} :</dt>
                            <dd>
                              {answerText(f, data[f.id], locale, { yes: t('yes'), no: t('no') })}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">{t('versionMissing')}</p>
                  )}
                  {typeof r.data.correctionReason === 'string' && (
                    <p className="text-xs text-muted-foreground">
                      {t('correctedBecause', { reason: r.data.correctionReason })}
                    </p>
                  )}
                  {canRecord && !superseded && !open && version && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="justify-self-start"
                      onClick={() => start(version, r)}
                    >
                      {t('correct')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
