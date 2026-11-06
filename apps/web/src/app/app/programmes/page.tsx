'use client';

import { useTranslations } from 'next-intl';
import { FollowUpList } from '@/features/record/follow-up-list';
import { PageHeader } from '@/features/shell/page-header';

export default function ProgramsPage() {
  const t = useTranslations('record.followUp');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <FollowUpList />
    </div>
  );
}
