'use client';

import { ArrowLeft, Construction } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { SOON_WEEKS } from '@/features/shell/navigation';

function ComingSoon() {
  const t = useTranslations('comingSoon');
  const nav = useTranslations('app.nav');
  const moduleKey = useSearchParams().get('m') ?? '';
  const week = SOON_WEEKS[moduleKey];
  const name = week ? nav(moduleKey) : nav('dashboard');

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-20 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent text-primary">
        <Construction className="size-6" aria-hidden />
      </span>
      <h1 className="mt-6 text-2xl font-semibold">{t('title', { module: name })}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {t('text', { week: week ?? '' })}
      </p>
      <Button asChild variant="secondary" className="mt-8">
        <Link href="/app">
          <ArrowLeft />
          {t('back')}
        </Link>
      </Button>
    </div>
  );
}

export default function ComingSoonPage() {
  return (
    <Suspense>
      <ComingSoon />
    </Suspense>
  );
}
