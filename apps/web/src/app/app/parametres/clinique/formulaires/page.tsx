'use client';

import { useTranslations } from 'next-intl';
import { FormBuilder } from '@/features/forms/form-builder';
import { PageHeader } from '@/features/shell/page-header';

export default function FormsSettingsPage() {
  const t = useTranslations('settings.forms');
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <FormBuilder />
    </div>
  );
}
