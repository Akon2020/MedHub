import plansData from '@medhub/db/seeds/platform/plans.json';
import {
  ArrowRight,
  Boxes,
  CloudOff,
  HeartPulse,
  Layers,
  Lock,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { HeroPreview } from '@/features/public/hero-preview';
import { ModulesTabs } from '@/features/public/modules-tabs';
import { Pricing, type PublicPlan } from '@/features/public/pricing';
import { PublicNav } from '@/features/public/public-nav';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-card px-3 py-1 text-xs font-medium text-slate-ink ring-1 ring-border">
      {children}
    </span>
  );
}

export default async function HomePage() {
  const t = await getTranslations('public');
  const year = new Date().getFullYear();

  const pillars = [
    { key: 'offline', icon: CloudOff },
    { key: 'record', icon: HeartPulse },
    { key: 'finance', icon: Wallet },
  ] as const;

  const facts = [
    { value: '100 %', key: 'offline' },
    { value: 'USD · CDF', key: 'currencies' },
    { value: 'FR · EN', key: 'languages' },
    { value: 'RLS', key: 'isolation' },
  ] as const;

  const why = [
    { key: 'integrated', icon: Layers },
    { key: 'workflows', icon: SlidersHorizontal },
    { key: 'billing', icon: Boxes },
    { key: 'security', icon: ShieldCheck },
    { key: 'hosting', icon: ServerCog },
  ] as const;

  return (
    <div className="page-backdrop min-h-dvh overflow-x-clip">
      <div className="hero-backdrop pb-24 pt-3 sm:pt-4">
        <PublicNav />
        <section className="mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-slate-ink">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {t('hero.badge')}
          </span>
          <h1 className="mx-auto mt-6 max-w-4xl text-[2.6rem] font-semibold leading-[1.05] sm:text-6xl lg:text-[4.2rem]">
            <span className="text-foreground">{t('hero.titleA')}</span>{' '}
            <span className="inline-flex translate-y-[-0.08em] items-center rounded-full bg-primary px-3 py-1.5 align-middle text-primary-foreground sm:px-4">
              <Stethoscope className="size-7 sm:size-9" aria-hidden />
            </span>{' '}
            <span className="text-primary">{t('hero.titleB')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-ink sm:text-lg">
            {t('hero.subtitle')}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/connexion">
                {t('hero.ctaPrimary')}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="#modules">{t('hero.ctaSecondary')}</a>
            </Button>
          </div>
          <HeroPreview />
        </section>
      </div>

      <section id="fonctionnalites" className="mx-auto -mt-12 max-w-6xl scroll-mt-28 px-4 sm:px-6">
        <div className="rounded-[32px] bg-card p-6 shadow-[0_30px_80px_-50px_rgb(13_29_29/0.35)] ring-1 ring-border sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Eyebrow>{t('pillars.eyebrow')}</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-semibold sm:text-4xl">
                {t('pillars.title')}
              </h2>
            </div>
            <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
              {t('pillars.subtitle')}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {pillars.map(({ key, icon: Icon }) => (
              <article key={key} className="rounded-[22px] bg-secondary/70 p-6 ring-1 ring-border">
                <span className="inline-grid size-11 place-items-center rounded-xl bg-card text-primary ring-1 ring-border">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{t(`pillars.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`pillars.${key}.text`)}
                </p>
              </article>
            ))}
          </div>
          <article className="mt-4 overflow-hidden rounded-[22px] bg-primary p-6 text-primary-foreground sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="inline-grid size-11 shrink-0 place-items-center rounded-xl bg-primary-foreground/15">
                <SlidersHorizontal className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-lg font-semibold">{t('pillars.config.title')}</h3>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-primary-foreground/80">
                  {t('pillars.config.text')}
                </p>
              </div>
            </div>
            <Lock
              className="mt-6 hidden size-16 shrink-0 text-primary-foreground/15 sm:mt-0 sm:block"
              aria-hidden
            />
          </article>

          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-border pt-10 lg:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.key}>
                <dt className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  {fact.value}
                </dt>
                <dd className="mt-2 text-sm text-muted-foreground">{t(`facts.${fact.key}`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-24 sm:px-6">
        <div className="text-center">
          <Eyebrow>{t('modules.eyebrow')}</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold sm:text-4xl">
            {t('modules.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted-foreground">
            {t('modules.subtitle')}
          </p>
        </div>
        <div className="mt-10">
          <ModulesTabs />
        </div>
      </section>

      <section id="avantages" className="mx-auto max-w-6xl scroll-mt-28 px-4 sm:px-6">
        <div className="glass grid gap-10 rounded-[32px] p-6 sm:p-10 lg:grid-cols-2">
          <div>
            <Eyebrow>{t('why.eyebrow')}</Eyebrow>
            <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">{t('why.title')}</h2>
            <ul className="mt-8 grid gap-2">
              {why.map(({ key, icon: Icon }, index) => (
                <li
                  key={key}
                  className={`flex gap-4 rounded-2xl p-4 ${index === 1 ? 'bg-card ring-1 ring-border' : ''}`}
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-semibold">{t(`why.items.${key}.title`)}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t(`why.items.${key}.text`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex min-h-80 items-center justify-center overflow-hidden rounded-[26px] bg-gradient-to-br from-brand to-brand-deep p-8">
            <div className="absolute inset-0 opacity-30 [background-image:repeating-linear-gradient(90deg,transparent_0,transparent_46px,rgb(255_255_255/0.25)_48px,transparent_52px)]" />
            <div className="relative grid w-full max-w-sm gap-3">
              <div className="rounded-2xl bg-card/95 p-4 shadow-xl">
                <p className="text-xs text-muted-foreground">{t('preview.lastVitals')}</p>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-[13px] text-slate-ink">{t('preview.temperature')}</p>
                    <p className="font-display text-3xl font-semibold">38,4 °C</p>
                  </div>
                  <svg viewBox="0 0 120 40" className="h-10 w-28" aria-hidden>
                    <path
                      d="M0,30 L20,26 L40,28 L60,18 L80,20 L100,8 L120,12"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
              </div>
              <div className="ml-8 rounded-2xl bg-card/95 p-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium">{t('preview.offline')}</p>
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                    {t('preview.pendingOps', { count: 12 })}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-2/3 rounded-full bg-primary" />
                </div>
              </div>
              <p className="text-right text-[11px] uppercase tracking-wide text-white/60">
                {(await getTranslations('common'))('fictitiousData')}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="tarifs" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-24 sm:px-6">
        <div className="text-center">
          <Eyebrow>{t('pricing.eyebrow')}</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold sm:text-5xl">
            {t('pricing.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted-foreground">
            {t('pricing.subtitle')}
          </p>
        </div>
        <div className="mt-10">
          <Pricing
            plans={plansData.plans as PublicPlan[]}
            currency={plansData.currency}
            annualMonthsCharged={plansData.annualMonthsCharged}
          />
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="hero-backdrop relative overflow-hidden rounded-[32px] px-6 py-16 text-center ring-1 ring-white/60">
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold sm:text-4xl">
            {t('cta.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-slate-ink">{t('cta.subtitle')}</p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/connexion">
              {t('cta.button')}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border bg-card/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">{t('footer.tagline')}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">{t('footer.product')}</p>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <li>
                <a href="#fonctionnalites" className="hover:text-primary">
                  {t('nav.features')}
                </a>
              </li>
              <li>
                <a href="#modules" className="hover:text-primary">
                  {t('nav.modules')}
                </a>
              </li>
              <li>
                <a href="#tarifs" className="hover:text-primary">
                  {t('nav.pricing')}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">{t('footer.access')}</p>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <li>
                <Link href="/connexion" className="hover:text-primary">
                  {t('footer.signIn')}
                </Link>
              </li>
              <li>
                <a href="/api/health" className="hover:text-primary">
                  {t('footer.status')}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="border-t border-border py-6 text-center text-xs text-muted-foreground">
          {t('footer.rights', { year })}
        </p>
      </footer>
    </div>
  );
}
