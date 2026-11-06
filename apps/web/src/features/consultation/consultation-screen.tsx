'use client';

import { activeBreakGlass, mergeClosure, patientFullName, recordAccess } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AllergyBanner, toAllergyView } from '@/features/record/record-lists';
import { LockedRecord, toGrant } from '@/features/record/break-glass';
import { useRecordAccess } from '@/features/record/use-record-access';
import { openVisitOfToday, todayTickets } from '@/features/visits/visit-helpers';
import { DiagnosesPanel } from './diagnoses-panel';
import { NoteEditor } from './note-editor';

/**
 * Consultation (docs/07-ui-ux.md 5.3): compact summary on the left, note and
 * coded diagnoses in the centre, prescription on the right. Everything works
 * offline; the first signed note starts the consultation, closing the visit
 * finishes the ticket being served.
 */
export function ConsultationScreen({ patientId }: { patientId: string }) {
  const t = useTranslations('consultation');
  const tErr = useTranslations('errors');
  const { dispatch, identity } = useRuntime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const { data } = useLocalQuery(
    async (store) => {
      const patient = await store.readEntity('patient', patientId);
      if (!patient) return null;
      const records = (await store.readEntities('patient')).map((p) => ({
        id: p.id,
        mergedIntoId: typeof p.data.mergedIntoId === 'string' ? p.data.mergedIntoId : null,
      }));
      const ids = mergeClosure(patientId, records);
      const gather = async (entity: string) =>
        (await Promise.all(ids.map((pid) => store.readEntitiesByPatient(entity, pid)))).flat();
      const encounters = await store.readEntitiesByPatient('encounter', patientId);
      const visitId = openVisitOfToday(encounters);
      const visit = encounters.find((e) => e.id === visitId) ?? null;
      const byVisit = (rows: Awaited<ReturnType<typeof gather>>) =>
        rows.filter((r) => (visitId ? r.data.encounterId === visitId : !r.data.encounterId));
      return {
        patient,
        visitId,
        visitStatus: typeof visit?.data.status === 'string' ? visit.data.status : null,
        notes: byVisit(await gather('clinical_note')),
        diagnoses: byVisit(await gather('diagnosis')),
        allergies: (await gather('allergy')).map(toAllergyView),
        problems: (await gather('problem')).filter((p) => p.data.status === 'active'),
        tickets: todayTickets(await store.readEntitiesByPatient('queue_ticket', patientId)),
        grants: (await store.readEntitiesByPatient('break_glass', patientId)).map(toGrant),
      };
    },
    [patientId],
  );

  const access = data
    ? recordAccess(
        data.patient.data.sensitivity,
        identity?.sensitivityMax ?? 'normal',
        activeBreakGlass(data.grants, identity?.userId ?? '', patientId, now),
      )
    : null;
  useRecordAccess(
    patientId,
    access === 'emergency' ? 'break_glass' : 'patient_record',
    access === 'open' || access === 'emergency',
  );

  if (!data) return <p className="text-sm text-muted-foreground">{t('notOnDevice')}</p>;
  if (access === 'locked') {
    return <LockedRecord patientId={patientId} mrn={String(data.patient.data.mrn ?? '')} />;
  }

  const d = data.patient.data;
  const name = patientFullName({
    familyName: String(d.familyName ?? ''),
    middleName: typeof d.middleName === 'string' ? d.middleName : null,
    givenName: typeof d.givenName === 'string' ? d.givenName : null,
  });
  const canClose = identity?.permissions.includes('encounter:close') ?? false;
  const open = data.visitStatus !== null && data.visitStatus !== 'completed';

  async function closeVisit() {
    if (!data?.visitId) return;
    setBusy(true);
    setError(null);
    try {
      const at = new Date().toISOString();
      for (const ticket of data.tickets) {
        if (ticket.encounterId === data.visitId && ticket.status === 'in_service') {
          await dispatch('queue_ticket.complete', { completedAt: at }, { entityId: ticket.id });
        }
      }
      await dispatch(
        'encounter.close',
        { status: 'completed', endedAt: at },
        { entityId: data.visitId },
      );
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        href={`/app/patients/fiche?id=${patientId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('backToRecord')}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <span className="font-mono text-xs text-slate-ink">{String(d.mrn ?? '')}</span>
        {data.visitStatus && <Badge variant="info">{t(`status.${data.visitStatus}`)}</Badge>}
        {!data.visitId && <Badge variant="warning">{t('noVisit')}</Badge>}
        {canClose && open && data.visitId && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void closeVisit()}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {t('closeVisit')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      <AllergyBanner rows={data.allergies} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('problems')}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {data.problems.length === 0 ? (
                <p className="text-muted-foreground">{t('noProblem')}</p>
              ) : (
                <ul className="grid gap-1">
                  {data.problems.map((p) => (
                    <li key={p.id}>{String(p.data.label)}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <DiagnosesPanel
            patientId={patientId}
            encounterId={data.visitId}
            diagnoses={data.diagnoses}
          />
        </div>
        <NoteEditor
          key={data.visitId ?? 'none'}
          patientId={patientId}
          encounterId={data.visitId}
          notes={data.notes}
          onSigned={async () => {
            // The first signed note starts the consultation of the visit.
            if (
              data.visitId &&
              (data.visitStatus === 'arrived' || data.visitStatus === 'triaged') &&
              identity?.permissions.includes('encounter:update_status')
            ) {
              await dispatch(
                'encounter.update_status',
                { status: 'in_consultation' },
                { entityId: data.visitId },
              );
            }
          }}
        />
      </div>
    </div>
  );
}
