'use client';

import type { VitalSignCode } from '@medhub/shared';
import { ArrowLeft, GitMerge, Phone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { FieldHistory, IdentityCard } from '@/features/patients/identity-card';
import { PatientCardActions } from '@/features/patients/patient-card';
import {
  DeathPanel,
  FavoriteToggle,
  PatientStatusBadges,
  ProvisionalPanel,
  SensitivityPanel,
  deceasedAtOf,
} from '@/features/patients/patient-status';
import {
  favoritesOf,
  initialsOf,
  isMerged,
  toPatientView,
} from '@/features/patients/patient-helpers';
import { mergeClosure, mergeTarget } from '@medhub/domain';
import { SyncBadge } from '@/features/patients/sync-badge';
import { VitalsPanel, type VitalView } from '@/features/patients/vitals-panel';
import { PatientAppointments } from '@/features/appointments/patient-appointments';
import {
  AllergiesCard,
  AllergyBanner,
  HistoryCard,
  ProblemsCard,
  toAllergyView,
} from '@/features/record/record-lists';
import { useRecordAccess } from '@/features/record/use-record-access';
import { VitalsSummary } from '@/features/record/vitals-summary';
import { ArrivalPanel } from '@/features/visits/arrival-panel';
import { TriagePanel } from '@/features/visits/triage-panel';
import { currentTriage, openVisitOfToday, todayTickets } from '@/features/visits/visit-helpers';

function PatientRecord() {
  const t = useTranslations('patient');
  const tp = useTranslations('patients');
  const tc = useTranslations('common');

  const id = useSearchParams().get('id') ?? '';
  const { identity } = useRuntime();
  const clinical = identity?.permissions.includes('clinical_record:read') ?? false;
  useRecordAccess(id, 'patient_record');

  const { data, loading } = useLocalQuery(
    async (store) => {
      const entity = id ? await store.readEntity('patient', id) : null;
      if (!entity || entity.rejected) return null;
      const records = (await store.readEntities('patient')).map((p) => ({
        id: p.id,
        mergedIntoId: typeof p.data.mergedIntoId === 'string' ? p.data.mergedIntoId : null,
      }));
      if (isMerged(entity)) {
        const into = new Map(records.map((r) => [r.id, r.mergedIntoId]));
        return { redirect: mergeTarget(id, (r) => into.get(r)) } as const;
      }
      // Records merged into this one keep their own rows: their vitals are shown here too.
      const ids = mergeClosure(id, records);
      const rows = (
        await Promise.all(ids.map((pid) => store.readEntitiesByPatient('vital_sign', pid)))
      ).flat();
      const vitals = rows
        .map<VitalView>((v) => ({
          id: v.id,
          code: v.data.code as VitalSignCode,
          value: Number(v.data.value),
          unit: String(v.data.unit ?? ''),
          measuredAt: String(v.data.measuredAt),
          status: String(v.data.status ?? 'active'),
          pending: v.version === 0,
          overrideReason:
            typeof v.data.plausibilityOverrideReason === 'string'
              ? v.data.plausibilityOverrideReason
              : null,
        }))
        .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
      const favorite = favoritesOf(await store.readEntitiesByPatient('patient_favorite', id)).has(
        id,
      );
      const visitId = openVisitOfToday(await store.readEntitiesByPatient('encounter', id));
      const triage = visitId
        ? currentTriage(await store.readEntitiesByPatient('triage', id), visitId)
        : null;
      const tickets = todayTickets(await store.readEntitiesByPatient('queue_ticket', id));
      // Facts recorded under a merged record belong to this patient too.
      const gather = async (entity: string) =>
        (await Promise.all(ids.map((pid) => store.readEntitiesByPatient(entity, pid)))).flat();
      const allergies = (await gather('allergy')).map(toAllergyView);
      const history = await gather('medical_history');
      const problems = await gather('problem');
      return {
        patient: toPatientView(entity),
        raw: entity.data,
        vitals,
        favorite,
        visitId,
        triage,
        tickets,
        allergies,
        history,
        problems,
        mergedCount: ids.length - 1,
      };
    },
    [id],
  );

  const router = useRouter();
  const redirect = data && 'redirect' in data ? data.redirect : null;
  useEffect(() => {
    if (redirect && redirect !== id) {
      router.replace(`/app/patients/fiche?id=${redirect}&merged=${id}`);
    }
  }, [redirect, id, router]);
  const mergedFrom = useSearchParams().get('merged');

  if (loading && !data) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  if (!data || 'redirect' in data) {
    if (data && 'redirect' in data) {
      return <p className="text-sm text-muted-foreground">{t('mergedRedirect')}</p>;
    }
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-muted-foreground">{t('notFound')}</p>
        <Link href="/app/patients" className="mt-4 inline-block text-primary hover:underline">
          {t('back')}
        </Link>
      </div>
    );
  }

  const {
    patient,
    raw,
    vitals,
    favorite,
    visitId,
    triage,
    tickets,
    allergies,
    history,
    problems,
    mergedCount,
  } = data;

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/app/patients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>

      <section className="card-surface mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground">
          {initialsOf(patient.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="truncate">{patient.name}</span>
            <PatientStatusBadges data={raw} />
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono text-xs text-slate-ink">{patient.mrn}</span>
            <span>{tp(`sex.${patient.sex}`)}</span>
            {patient.age !== null && (
              <span>
                {tc('years', { count: patient.age })}
                {patient.birthDateEstimated ? ` (${t('estimated')})` : ''}
              </span>
            )}
            {patient.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" aria-hidden />
                {patient.phone}
              </span>
            )}
          </p>
        </div>
        <div className="grid justify-items-end gap-2">
          <div className="flex items-center gap-2">
            <FavoriteToggle patientId={patient.id} favorite={favorite} />
            <SyncBadge state={patient.syncState} />
          </div>
          <PatientCardActions
            patient={patient}
            cardToken={typeof raw.cardToken === 'string' ? raw.cardToken : null}
          />
          <SensitivityPanel patientId={patient.id} data={raw} />
          <DeathPanel patientId={patient.id} data={raw} />
        </div>
      </section>

      {raw.isProvisional === true && <ProvisionalPanel patientId={patient.id} />}
      {clinical && <AllergyBanner rows={allergies} />}

      {(mergedFrom || mergedCount > 0) && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2 rounded-xl bg-info-soft px-4 py-3 text-sm text-info"
        >
          <GitMerge className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {mergedFrom ? `${t('mergedFrom')} ` : ''}
            {mergedCount > 0 ? t('mergedCount', { count: mergedCount }) : ''}
          </span>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-6">
          {visitId && (
            <TriagePanel
              key={`${visitId}-${triage?.id ?? 'new'}`}
              patientId={patient.id}
              encounterId={visitId}
              triage={triage}
              tickets={tickets}
            />
          )}
          <VitalsPanel
            patientId={patient.id}
            vitals={vitals}
            deceasedAt={deceasedAtOf(raw)}
            encounterId={visitId}
          />
          {clinical && (
            <>
              <AllergiesCard patientId={patient.id} rows={allergies} />
              <ProblemsCard patientId={patient.id} rows={problems} />
              <HistoryCard patientId={patient.id} rows={history} />
            </>
          )}
        </div>
        <div className="grid content-start gap-6">
          <ArrivalPanel patientId={patient.id} deceased={deceasedAtOf(raw) !== null} />
          <PatientAppointments patientId={patient.id} />
          <VitalsSummary vitals={vitals} sex={patient.sex} birthDate={patient.birthDate} />
          <IdentityCard key={patient.id} patientId={patient.id} data={raw} />
          <FieldHistory patientId={patient.id} />
        </div>
      </div>
    </div>
  );
}

export default function PatientRecordPage() {
  return (
    <Suspense>
      <PatientRecord />
    </Suspense>
  );
}
