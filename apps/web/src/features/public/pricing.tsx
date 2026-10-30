'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formattingLocale, isLocale } from '@/i18n/config';
import { cn } from '@/lib/utils';

export type PublicPlan = {
  code: string;
  name: { fr: string; en: string };
  profile: { fr: string; en: string };
  monthlyPriceMinor: number;
  quoteOnly: boolean;
  highlighted?: boolean;
  features: { fr: string[]; en: string[] };
};

type Props = { plans: PublicPlan[]; currency: string; annualMonthsCharged: number };

export function Pricing({ plans, currency, annualMonthsCharged }: Props) {
  const t = useTranslations('public.pricing');
  const raw = useLocale();
  const locale = isLocale(raw) ? raw : 'fr';
  const [annual, setAnnual] = useState(false);

  const format = (minor: number) =>
    new Intl.NumberFormat(formattingLocale(locale), {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);

  return (
    <div>
      <div className="mx-auto flex w-fit items-center gap-1 rounded-full bg-card/80 p-1 ring-1 ring-border">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={annual === value}
            onClick={() => setAnnual(value)}
            className={cn(
              'rounded-full px-5 py-2.5 text-sm font-medium transition-colors',
              annual === value
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-ink hover:text-foreground',
            )}
          >
            {value ? t('annual') : t('monthly')}
            {value && (
              <span
                className={cn(
                  'ml-2 rounded-full px-2 py-0.5 text-[11px]',
                  annual ? 'bg-primary-foreground/20' : 'bg-accent text-accent-foreground',
                )}
              >
                {t('annualNote')}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const highlighted = plan.highlighted === true;
          const amount = annual
            ? plan.monthlyPriceMinor * annualMonthsCharged
            : plan.monthlyPriceMinor;
          return (
            <article
              key={plan.code}
              className={cn(
                'relative flex flex-col rounded-[24px] p-6 ring-1 transition-transform',
                highlighted
                  ? 'bg-primary text-primary-foreground shadow-[0_30px_60px_-30px_rgb(15_107_107/0.7)] ring-primary xl:-translate-y-3'
                  : 'bg-card ring-border',
              )}
            >
              {highlighted && (
                <span className="absolute right-5 top-5 rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-medium">
                  {t('popular')}
                </span>
              )}
              <h3 className="text-xl font-semibold">{plan.name[locale]}</h3>
              <p
                className={cn(
                  'mt-1 text-sm',
                  highlighted ? 'text-primary-foreground/75' : 'text-muted-foreground',
                )}
              >
                {plan.profile[locale]}
              </p>
              <div className="mt-6 min-h-16">
                {plan.quoteOnly && (
                  <p
                    className={cn(
                      'text-xs',
                      highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {t('from')}
                  </p>
                )}
                <p className="font-display text-4xl font-semibold tracking-tight">
                  {format(amount)}
                  <span
                    className={cn(
                      'ml-1 text-sm font-normal',
                      highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {annual ? t('perYear') : t('perMonth')}
                  </span>
                </p>
              </div>
              <ul className="mt-6 grid flex-1 gap-3 text-sm">
                {plan.features[locale].map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
                        highlighted ? 'bg-primary-foreground/15' : 'bg-accent text-primary',
                      )}
                    >
                      <Check className="size-3" aria-hidden />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={highlighted ? 'secondary' : 'outline'}
                className="mt-8 w-full"
              >
                <Link href={plan.quoteOnly ? '#contact' : '/connexion'}>
                  {plan.quoteOnly ? t('contact') : t('choose')}
                </Link>
              </Button>
            </article>
          );
        })}
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
        {t('disclaimer')}
      </p>
    </div>
  );
}
