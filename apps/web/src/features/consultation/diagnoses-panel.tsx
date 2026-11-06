'use client';

import { searchDiagnoses, type DiagnosisCatalogItem } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { Check, Loader2, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Coded diagnoses of the visit: chosen from the structure's imported list, or
 * a free label with an optional ICD-10 code (format checked). A correction
 * supersedes the diagnosis, which stays readable.
 */
export function DiagnosesPanel({
  patientId,
  encounterId,
  diagnoses,
}: {
  patientId: string;
  encounterId: string | null;
  diagnoses: LocalEntity[];
}) {
  const t = useTranslations('consultation.diagnoses');
  const tErr = useTranslations('errors');
  const { dispatch, catalogs, identity } = useRuntime();
  const catalog = catalogs?.snapshot.diagnoses ?? [];
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<DiagnosisCatalogItem | null>(null);
  const [code, setCode] = useState('');
  const [suspected, setSuspected] = useState(false);
  const [primary, setPrimary] = useState(diagnoses.length === 0);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdd = identity?.permissions.includes('diagnosis:create') ?? false;
  const matches = picked ? [] : searchDiagnoses(catalog, query);
  const active = diagnoses.filter((d) => !d.rejected && d.data.status !== 'superseded');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dispatch('diagnosis.add', {
        patientId,
        encounterId,
        codeSystem: picked?.codeSystem ?? 'ICD10',
        code: picked?.code ?? (code.trim() || null),
        label: picked?.label ?? query.trim(),
        certainty: suspected ? 'suspected' : 'confirmed',
        isPrimary: primary,
        diagnosedAt: new Date().toISOString(),
        supersedesId: replacing,
      });
      setQuery('');
      setPicked(null);
      setCode('');
      setSuspected(false);
      setPrimary(false);
      setReplacing(null);
    } catch (err) {
      const c = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(c) ? tErr(c) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {active.length === 0 && <p className="text-muted-foreground">{t('none')}</p>}
        <ul className="grid gap-1.5">
          {active.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              {d.data.isPrimary === true && <Badge variant="info">{t('primary')}</Badge>}
              <span className="font-medium">{String(d.data.label)}</span>
              {typeof d.data.code === 'string' && (
                <span className="font-mono text-xs text-muted-foreground">{d.data.code}</span>
              )}
              {d.data.certainty === 'suspected' && (
                <Badge variant="warning">{t('suspected')}</Badge>
              )}
              {canAdd && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReplacing(d.id);
                    setQuery(String(d.data.label));
                    setCode(typeof d.data.code === 'string' ? d.data.code : '');
                    setPrimary(d.data.isPrimary === true);
                  }}
                >
                  {t('correct')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canAdd && (
          <form onSubmit={submit} className="grid gap-2 rounded-xl bg-muted/50 p-3" noValidate>
            <Label htmlFor="diagnosis-query">{replacing ? t('correctTitle') : t('search')}</Label>
            <Input
              id="diagnosis-query"
              value={picked ? `${picked.code} · ${picked.label}` : query}
              onChange={(e) => {
                setPicked(null);
                setQuery(e.target.value);
              }}
              autoComplete="off"
            />
            {matches.length > 0 && (
              <ul className="grid gap-1">
                {matches.map((m) => (
                  <li key={`${m.codeSystem}:${m.code}`}>
                    <button
                      type="button"
                      className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => setPicked(m)}
                    >
                      <span className="font-mono text-xs">{m.code}</span> {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!picked && (
              <Input
                aria-label={t('code')}
                placeholder={t('code')}
                className="max-w-40"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            )}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={primary}
                  onChange={(e) => setPrimary(e.target.checked)}
                />
                {t('primary')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={suspected}
                  onChange={(e) => setSuspected(e.target.checked)}
                />
                {t('suspected')}
              </label>
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
                disabled={busy || (!picked && query.trim().length < 2)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t('add')}
              </Button>
              {replacing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(null)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
            {catalog.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('noCatalog')}</p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
