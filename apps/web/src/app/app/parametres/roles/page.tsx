'use client';

import { useTranslations } from 'next-intl';
import { RolesSettings } from '@/features/settings/roles-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function RolesSettingsPage() {
  const t = useTranslations('settings.roles');
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <RolesSettings />
    </div>
  );
}
