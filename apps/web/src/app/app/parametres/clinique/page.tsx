'use client';

import { useTranslations } from 'next-intl';
import { VitalDefinitionsSettings } from '@/features/settings/vital-definitions-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function ClinicalSettingsPage() {
  const t = useTranslations('settings.clinical');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <VitalDefinitionsSettings />
    </div>
  );
}
