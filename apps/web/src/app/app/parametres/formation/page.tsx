'use client';

import { useTranslations } from 'next-intl';
import { TrainingSettings } from '@/features/settings/training-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function TrainingSettingsPage() {
  const t = useTranslations('settings.training');
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <TrainingSettings />
    </div>
  );
}
