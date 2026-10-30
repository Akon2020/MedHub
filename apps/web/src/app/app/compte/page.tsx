'use client';

import { useTranslations } from 'next-intl';
import { AccountSecurity } from '@/features/account/account-security';
import { PageHeader } from '@/features/shell/page-header';

export default function AccountPage() {
  const t = useTranslations('account');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AccountSecurity />
    </div>
  );
}
