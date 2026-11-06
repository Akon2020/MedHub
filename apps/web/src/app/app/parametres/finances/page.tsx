'use client';

import { useTranslations } from 'next-intl';
import { FinanceSettings } from '@/features/settings/finance-settings';
import { PageHeader } from '@/features/shell/page-header';

export default function FinanceSettingsPage() {
  const t = useTranslations('settings.finance');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <FinanceSettings />
    </div>
  );
}
