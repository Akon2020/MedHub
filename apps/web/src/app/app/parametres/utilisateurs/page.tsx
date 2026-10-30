'use client';

import { useTranslations } from 'next-intl';
import { UsersSettings } from '@/features/settings/users-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function UsersSettingsPage() {
  const t = useTranslations('settings.users');
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <UsersSettings />
    </div>
  );
}
