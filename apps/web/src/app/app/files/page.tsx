'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/features/shell/page-header';
import { QueueBoard } from '@/features/visits/queue-board';

export default function QueuesPage() {
  const t = useTranslations('visits.board');
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <QueueBoard />
    </div>
  );
}
