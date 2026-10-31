'use client';

import { useTranslations } from 'next-intl';
import { ReferenceSettings } from '@/features/settings/reference-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function ReferenceSettingsPage() {
  const t = useTranslations('settings.reference');
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ReferenceSettings />
    </div>
  );
}
