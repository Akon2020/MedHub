'use client';

import { useTranslations } from 'next-intl';
import { OrganizationSettings } from '@/features/settings/organization-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function OrganizationPage() {
  const t = useTranslations('settings.organization');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <OrganizationSettings />
    </div>
  );
}
