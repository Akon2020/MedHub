'use client';

import { followUpStatus } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { Loader2, Plus, Repeat } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';

/**
 * Chronic care programmes of the patient (docs/modules/dpi.md section 6):
 * enrolment and discharge offline, next expected visit from the last contact
 * known on the device.
 */
export function ProgramsCard({
  patientId,
  enrollments,
  lastContact,
}: {
  patientId: string;
  enrollments: LocalEntity[];
  lastContact: string | null;
}) {
  const t = useTranslations('record.programs');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, catalogs, identity } = useRuntime();
  const programs = catalogs?.snapshot.programs ?? [];
  const canWrite = identity?.permissions.includes('clinical_record:create') ?? false;
  const active = enrollments.filter((e) => e.data.status === 'active');
  const available = programs.filter((p) => !active.some((e) => e.data.programId === p.id));
  const [choice, setChoice] = useState('');
  const [leaving, setLeaving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const selected = available.some((p) => p.id === choice) ? choice : (available[0]?.id ?? '');

  if (programs.length === 0 && active.length === 0) return null;

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      setLeaving(null);
      setReason('');
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {active.length === 0 && <p className="text-muted-foreground">{t('none')}</p>}
        <ul className="divide-y divide-border">
          {active.map((e) => {
            const p = programs.find((x) => x.id === e.data.programId);
            const status = followUpStatus({
              enrolledAt: String(e.data.enrolledAt),
              lastContact,
              intervalDays: p?.followUpIntervalDays ?? 30,
              graceDays: p?.graceDays ?? 14,
              now,
            });
            return (
              <li key={e.id} className="grid gap-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{p?.name ?? ''}</span>
                  {status.lost ? (
                    <Badge variant="danger">{t('lost', { days: status.daysLate })}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t('due', {
                        date: format.dateTime(new Date(status.dueAt), { dateStyle: 'medium' }),
                      })}
                    </span>
                  )}
                  {canWrite && leaving !== e.id && (
                    <Button size="sm" variant="ghost" onClick={() => setLeaving(e.id)}>
                      {t('discharge')}
                    </Button>
                  )}
                </div>
                {leaving === e.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={t('reason')}
                      placeholder={t('reason')}
                      className="max-w-sm"
                      value={reason}
                      onChange={(ev) => setReason(ev.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || reason.trim().length < 3}
                      onClick={() =>
                        void run(() =>
                          dispatch(
                            'program_enrollment.discharge',
                            {
                              dischargedAt: new Date().toISOString(),
                              dischargeReason: reason.trim(),
                            },
                            { entityId: e.id },
                          ),
                        )
                      }
                    >
                      {t('confirmDischarge')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setLeaving(null)}>
                      {t('cancel')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && available.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={t('choose')}
              className="max-w-xs"
              value={selected}
              onChange={(e) => setChoice(e.target.value)}
            >
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !selected}
              onClick={() =>
                void run(() =>
                  dispatch('program_enrollment.enroll', {
                    patientId,
                    programId: selected,
                    enrolledAt: new Date().toISOString(),
                  }),
                )
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {t('enroll')}
            </Button>
          </div>
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
