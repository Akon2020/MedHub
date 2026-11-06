'use client';

import { RECONCILIATION_DECISIONS } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { Check, ListChecks, Loader2, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';

type Decision = (typeof RECONCILIATION_DECISIONS)[number];

/**
 * Habitual treatments and simple reconciliation (docs/modules/dpi.md 5): the
 * treatments the patient reports are listed beside the prescription; for each
 * one the prescriber decides to continue, stop or modify, and the decision is
 * recorded with the visit. Stopping one also closes the statement.
 */
export function MedicationPanel({
  patientId,
  encounterId,
  statements,
  reconciliations,
}: {
  patientId: string;
  encounterId: string | null;
  statements: LocalEntity[];
  reconciliations: LocalEntity[];
}) {
  const t = useTranslations('medication');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, identity } = useRuntime();
  const [label, setLabel] = useState('');
  const [dose, setDose] = useState('');
  const [decisions, setDecisions] = useState<Record<string, { decision: Decision; note: string }>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = identity?.permissions.includes('clinical_record:create') ?? false;
  const active = statements.filter((s) => !s.rejected && s.data.status === 'active');
  const last = reconciliations
    .filter((r) => !r.rejected)
    .sort((a, b) => String(b.data.performedAt).localeCompare(String(a.data.performedAt)))[0];

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await dispatch('medication_statement.add', {
        patientId,
        label: label.trim(),
        dose: dose.trim() || null,
        source: 'patient_report',
        notedAt: new Date().toISOString(),
      });
      setLabel('');
      setDose('');
    });
  }

  function reconcile() {
    void run(async () => {
      const now = new Date();
      const chosen = active.map((s) => ({
        statementId: s.id,
        label: String(s.data.label),
        decision: decisions[s.id]?.decision ?? 'continue',
        note: decisions[s.id]?.note.trim() || null,
      }));
      await dispatch('medication_reconciliation.record', {
        patientId,
        encounterId,
        kind: 'consultation',
        decisions: chosen,
        performedAt: now.toISOString(),
      });
      for (const c of chosen) {
        if (c.decision !== 'stop') continue;
        await dispatch(
          'medication_statement.stop',
          { status: 'stopped', stoppedOn: now.toISOString().slice(0, 10), stopReason: c.note },
          { entityId: c.statementId },
        );
      }
      setDecisions({});
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {active.length === 0 && <p className="text-muted-foreground">{t('none')}</p>}
        <ul className="grid gap-2">
          {active.map((s) => (
            <li key={s.id} className="grid gap-1.5">
              <p>
                <span className="font-medium">{String(s.data.label)}</span>
                {typeof s.data.dose === 'string' && (
                  <span className="text-muted-foreground"> · {s.data.dose}</span>
                )}
              </p>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <NativeSelect
                    aria-label={t('decision')}
                    className="h-9 max-w-44"
                    value={decisions[s.id]?.decision ?? 'continue'}
                    onChange={(e) =>
                      setDecisions({
                        ...decisions,
                        [s.id]: {
                          decision: e.target.value as Decision,
                          note: decisions[s.id]?.note ?? '',
                        },
                      })
                    }
                  >
                    {RECONCILIATION_DECISIONS.map((d) => (
                      <option key={d} value={d}>
                        {t(`decisions.${d}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label={t('note')}
                    placeholder={t('note')}
                    className="h-9 min-w-0 flex-1"
                    value={decisions[s.id]?.note ?? ''}
                    onChange={(e) =>
                      setDecisions({
                        ...decisions,
                        [s.id]: {
                          decision: decisions[s.id]?.decision ?? 'continue',
                          note: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        {canEdit && active.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="justify-self-start"
            disabled={busy}
            onClick={reconcile}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {t('reconcile')}
          </Button>
        )}
        {last && (
          <p className="text-xs text-muted-foreground">
            {t('lastReconciliation', {
              date: format.dateTime(new Date(String(last.data.performedAt)), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        )}
        {canEdit && (
          <form onSubmit={add} className="grid gap-2 rounded-xl bg-muted/50 p-3" noValidate>
            <Label htmlFor="med-label">{t('add')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="med-label"
                className="min-w-0 flex-1"
                placeholder={t('label')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Input
                aria-label={t('dose')}
                placeholder={t('dose')}
                className="max-w-40"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={busy || label.trim().length < 2}>
                <Plus />
                {t('addButton')}
              </Button>
            </div>
          </form>
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
