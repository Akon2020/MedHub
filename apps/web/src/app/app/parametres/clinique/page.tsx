'use client';

import { useTranslations } from 'next-intl';
import { DiagnosisCatalogSettings } from '@/features/settings/diagnosis-catalog-settings';
import { ProgramsSettings } from '@/features/settings/programs-settings';
import { VitalDefinitionsSettings } from '@/features/settings/vital-definitions-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function ClinicalSettingsPage() {
  const t = useTranslations('settings.clinical');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <VitalDefinitionsSettings />
      <ProgramsSettings />
      <DiagnosisCatalogSettings />
    </div>
  );
}
