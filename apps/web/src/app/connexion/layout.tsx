import { CloudOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <div className="hero-backdrop flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-8">
        <Link href="/" aria-label="MedHub">
          <Logo />
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-8">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] lg:grid-cols-[1.05fr_1fr]">
          <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary to-[#093f3f] p-10 text-primary-foreground lg:flex">
            <div className="absolute inset-0 opacity-25 [background-image:repeating-linear-gradient(90deg,transparent_0,transparent_46px,rgb(255_255_255/0.3)_48px,transparent_52px)]" />
            <div className="relative">
              <span className="inline-grid size-12 place-items-center rounded-2xl bg-white/15">
                <CloudOff className="size-5" aria-hidden />
              </span>
              <h2 className="mt-6 max-w-sm text-3xl font-semibold leading-tight">
                {t('sideTitle')}
              </h2>
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/80">
                {t('sideText')}
              </p>
            </div>
            <p className="relative flex items-center gap-2 text-sm text-white/75">
              <ShieldCheck className="size-4" aria-hidden />
              {t('secureNote')}
            </p>
          </section>
          <section className="glass rounded-[32px] p-6 sm:p-10 lg:rounded-l-none">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
