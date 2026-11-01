'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { Agenda } from '@/features/appointments/agenda';
import { PageHeader } from '@/features/shell/page-header';

export default function AppointmentsPage() {
  const t = useTranslations('appointments');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Suspense>
        <Agenda />
      </Suspense>
    </div>
  );
}
