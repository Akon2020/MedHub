'use client';

import { useTranslations } from 'next-intl';
import { ConfigurationSettings } from '@/features/settings/configuration-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function SyncSettingsPage() {
  const t = useTranslations('settings.configuration');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConfigurationSettings />
    </div>
  );
}
