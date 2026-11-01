'use client';

import { useTranslations } from 'next-intl';
import { RdvSettings } from '@/features/settings/rdv-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function RdvSettingsPage() {
  const t = useTranslations('settings.rdv');
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <RdvSettings />
    </div>
  );
}
