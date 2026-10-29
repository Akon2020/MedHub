'use client';

import type { VitalSignCode } from '@medhub/shared';
import { ArrowLeft, Phone, UserRound } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { useLocalQuery } from '@/client/runtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { initialsOf, toPatientView } from '@/features/patients/patient-helpers';
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
      const vitals = (await store.readEntitiesByPatient('vital_sign', id))
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
      return { patient: toPatientView(entity), vitals };
    },
    [id],
  );

  if (loading && !data) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  if (!data) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-muted-foreground">{t('notFound')}</p>
        <Link href="/app/patients" className="mt-4 inline-block text-primary hover:underline">
          {t('back')}
        </Link>
      </div>
    );
  }

  const { patient, vitals } = data;
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
          <h1 className="truncate text-2xl font-semibold">{patient.name}</h1>
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
        <SyncBadge state={patient.syncState} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <VitalsPanel patientId={patient.id} vitals={vitals} />
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="size-4 text-primary" aria-hidden />
                {t('identity')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">{t('mrn')}</dt>
                <dd className="font-mono text-xs">{patient.mrn}</dd>
                <dt className="text-muted-foreground">{tp('form.birthDate')}</dt>
                <dd>
                  {patient.birthDate
                    ? format.dateTime(new Date(`${patient.birthDate}T00:00:00Z`), {
                        dateStyle: 'long',
                        timeZone: 'UTC',
                      })
                    : ''}
                </dd>
                <dt className="text-muted-foreground">{tp('columns.phone')}</dt>
                <dd>{patient.phone ?? ''}</dd>
              </dl>
            </CardContent>
          </Card>
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
