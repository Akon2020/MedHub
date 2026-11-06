'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { ConsultationScreen } from '@/features/consultation/consultation-screen';
import { ConsultationQueue } from '@/features/consultation/consultation-queue';

function Consultation() {
  const patientId = useSearchParams().get('patient') ?? '';
  const t = useTranslations('consultation');
  if (!patientId) return <ConsultationQueue title={t('queueTitle')} />;
  return <ConsultationScreen key={patientId} patientId={patientId} />;
}

export default function ConsultationPage() {
  return (
    <Suspense>
      <Consultation />
    </Suspense>
  );
}
