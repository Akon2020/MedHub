'use client';

import type { DiagnosisImportError } from '@medhub/domain';
import { Check, FileUp, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStepUp } from '@/features/auth/step-up';

type Result = { items: number; errors: DiagnosisImportError[]; total?: number };

/**
 * Diagnosis list of the structure (S9 decision: nothing preloaded, the
 * structure imports its own ICD-10 extract or local list). Checked first, then
 * saved; the list reaches the workstations with the next catalog refresh.
 */
export function DiagnosisCatalogSettings() {
  const { catalogs } = useRuntime();
  return (
    <CatalogImport
      endpoint="/api/v1/diagnoses/import"
      namespace="settings.diagnoses"
      known={catalogs?.snapshot.diagnoses?.length ?? 0}
    />
  );
}

/** Drug catalogue and interaction rules of the structure (S9: nothing preloaded). */
export function DrugCatalogSettings() {
  const { catalogs } = useRuntime();
  return (
    <>
      <CatalogImport
        endpoint="/api/v1/drugs/import"
        namespace="settings.drugs"
        known={catalogs?.snapshot.drugs?.length ?? 0}
      />
      <CatalogImport
        endpoint="/api/v1/drug-interactions/import"
        namespace="settings.interactions"
        known={catalogs?.snapshot.interactionRules?.length ?? 0}
      />
    </>
  );
}

export function CatalogImport({
  endpoint,
  namespace,
  known,
  extra,
  onDone,
}: {
  endpoint: string;
  namespace:
    | 'settings.diagnoses'
    | 'settings.drugs'
    | 'settings.interactions'
    | 'settings.finance.services'
    | 'settings.finance.prices';
  known: number;
  /** Other fields of the request body (the price list of a price import). */
  extra?: Record<string, unknown>;
  onDone?: () => void;
}) {
  const t = useTranslations(namespace);
  const tErr = useTranslations('errors');
  const online = useOnline();
  const { identity, reloadCatalogs } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = identity?.permissions.includes('configuration:edit') ?? false;

  async function send(apply: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const call = () =>
        apiFetch<Result>(endpoint, {
          method: 'POST',
          body: JSON.stringify({ ...extra, csv, apply }),
        });
      const out = apply ? await guard(call) : await call();
      if (apply) {
        setNotice(t('saved', { count: out.items, total: out.total ?? out.items }));
        onDone?.();
        setCsv('');
        setResult(null);
        await reloadCatalogs();
      } else {
        setResult(out);
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle', { count: known })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        {!online && <p className="text-warning">{t('offline')}</p>}
        {canEdit && online && (
          <>
            <label className="inline-flex cursor-pointer items-center gap-2 justify-self-start rounded-full px-3.5 py-2 text-[13px] font-medium ring-1 ring-border hover:bg-muted">
              <FileUp className="size-4" aria-hidden />
              {t('chooseFile')}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setCsv(await file.text());
                    setResult(null);
                  }
                }}
              />
            </label>
            <textarea
              aria-label={t('paste')}
              placeholder={t('paste')}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setResult(null);
              }}
              rows={4}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="justify-self-start"
              disabled={busy || csv.trim().length === 0}
              onClick={() => void send(false)}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}
              {t('check')}
            </Button>
          </>
        )}
        {result && (
          <div className="grid gap-2" role="status">
            <p>{t('summary', { valid: result.items, errors: result.errors.length })}</p>
            {result.errors.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                {result.errors.map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    {t('error', {
                      line: e.line,
                      problem: tErr.has(e.message) ? tErr(e.message) : e.message,
                    })}
                  </li>
                ))}
              </ul>
            )}
            {result.items > 0 && result.errors.length === 0 && (
              <Button
                type="button"
                size="sm"
                className="justify-self-start"
                disabled={busy}
                onClick={() => void send(true)}
              >
                <Check />
                {t('apply', { count: result.items })}
              </Button>
            )}
          </div>
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
      </CardContent>
      {dialog}
    </Card>
  );
}
