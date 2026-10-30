'use client';

import { ArrowRight, Check, FlaskConical, Pill, Stethoscope, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'patients', icon: Users },
  { key: 'clinical', icon: Stethoscope },
  { key: 'billing', icon: Wallet },
  { key: 'pharmacy', icon: Pill },
  { key: 'lab', icon: FlaskConical },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function ModulesTabs() {
  const t = useTranslations('public.modules');
  const [active, setActive] = useState<TabKey>('patients');
  const points = t.raw(`${active}.points`) as string[];
  const ActiveIcon = TABS.find((tab) => tab.key === active)?.icon ?? Users;

  return (
    <div>
      <div
        role="tablist"
        aria-label={t('title')}
        className="glass mx-auto flex max-w-full gap-1 overflow-x-auto rounded-full p-1.5 sm:w-fit"
      >
        {TABS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            type="button"
            id={`tab-${key}`}
            aria-selected={active === key}
            aria-controls={`panel-${key}`}
            onClick={() => setActive(key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm transition-all',
              active === key
                ? 'bg-card font-medium text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(`${key}.tab`)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="glass mt-6 grid gap-8 rounded-[28px] p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:items-center"
      >
        <div>
          <span className="inline-grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <ActiveIcon className="size-5" aria-hidden />
          </span>
          <h3 className="mt-5 text-2xl font-semibold">{t(`${active}.title`)}</h3>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {t(`${active}.text`)}
          </p>
          <Button asChild className="mt-7">
            <Link href="/connexion">
              {t('learnMore')}
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {points.map((point, i) => (
            <li
              key={point}
              className={cn(
                'flex min-h-24 flex-col justify-between rounded-2xl p-4 ring-1',
                i === 0 ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card ring-border',
              )}
            >
              <Check
                className={cn('size-5', i === 0 ? 'text-teal-soft' : 'text-primary')}
                aria-hidden
              />
              <span className="mt-4 text-[15px] font-medium">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
