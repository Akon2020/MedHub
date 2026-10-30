'use client';

import { useTranslations } from 'next-intl';
import { DevicesSettings } from '@/features/settings/devices-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function DevicesPage() {
  const t = useTranslations('settings.devices');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DevicesSettings />
    </div>
  );
}
