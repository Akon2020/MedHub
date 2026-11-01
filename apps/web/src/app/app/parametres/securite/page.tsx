'use client';

import { useTranslations } from 'next-intl';
import { BreakGlassReview } from '@/features/settings/break-glass-review';
import { SecurityEvents } from '@/features/settings/security-events';
import { PageHeader } from '@/features/shell/page-header';

export default function SecurityPage() {
  const t = useTranslations('settings.security');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <BreakGlassReview />
      <SecurityEvents />
    </div>
  );
}
