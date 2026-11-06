'use client';

import { useTranslations } from 'next-intl';
import { ConventionsSettings } from '@/features/conventions/conventions-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function ConventionsPage() {
  const t = useTranslations('conventions');
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConventionsSettings />
    </div>
  );
}
