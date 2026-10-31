'use client';

import { useTranslations } from 'next-intl';
import { DuplicatesQueue } from '@/features/patients/duplicates-queue';
import { PageHeader } from '@/features/shell/page-header';

export default function DuplicatesPage() {
  const t = useTranslations('patients.queue');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DuplicatesQueue />
    </div>
  );
}
