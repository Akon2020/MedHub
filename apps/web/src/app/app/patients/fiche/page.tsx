'use client';

import type { VitalSignCode } from '@medhub/shared';
import { ArrowLeft, GitMerge, Phone } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Suspense, useEffect } from 'react';
import { useLocalQuery } from '@/client/runtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldHistory, IdentityCard } from '@/features/patients/identity-card';
import { PatientCardActions } from '@/features/patients/patient-card';
import {
  DeathPanel,
  PatientStatusBadges,
  ProvisionalPanel,
  deceasedAtOf,
} from '@/features/patients/patient-status';
import { initialsOf, isMerged, toPatientView } from '@/features/patients/patient-helpers';
import { mergeClosure, mergeTarget } from '@medhub/domain';
import { SyncBadge } from '@/features/patients/sync-badge';
import { VitalsPanel, type VitalView } from '@/features/patients/vitals-panel';

const TrendChart = dynamic(() => import('@/features/charts/trend-chart'), { ssr: false });

function PatientRecord() {
  const t = useTranslations('patient');
  const tp = useTranslations('patients');
  const tc = useTranslations('common');
  const format = useFormatter();
  const id = useSearchParams().get('id') ?? '';

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
      return {
        patient: toPatientView(entity),
        raw: entity.data,
        vitals,
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

  const { patient, raw, vitals, mergedCount } = data;
  const temperature = vitals
    .filter((v) => v.code === 'temp' && v.status === 'active')
    .slice(0, 12)
    .reverse()
    .map((v) => ({
      label: format.dateTime(new Date(v.measuredAt), {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      value: v.value,
    }));

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
          <SyncBadge state={patient.syncState} />
          <PatientCardActions
            patient={patient}
            cardToken={typeof raw.cardToken === 'string' ? raw.cardToken : null}
          />
          <DeathPanel patientId={patient.id} data={raw} />
        </div>
      </section>

      {raw.isProvisional === true && <ProvisionalPanel patientId={patient.id} />}

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
        <VitalsPanel patientId={patient.id} vitals={vitals} deceasedAt={deceasedAtOf(raw)} />
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('trend')}</CardTitle>
            </CardHeader>
            <CardContent>
              {temperature.length >= 2 ? (
                <TrendChart data={temperature} unit="°C" />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t('vitals.empty')}
                </p>
              )}
            </CardContent>
          </Card>
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
