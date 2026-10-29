'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '#fonctionnalites', key: 'features' },
  { href: '#modules', key: 'modules' },
  { href: '#avantages', key: 'why' },
  { href: '#tarifs', key: 'pricing' },
] as const;

export function PublicNav() {
  const t = useTranslations('public.nav');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    const sections = LINKS.map((l) => document.querySelector(l.href)).filter(
      (el): el is Element => el !== null,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(`#${entry.target.id}`);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-3 z-40 px-3 sm:top-4 sm:px-6">
      <nav className="glass mx-auto flex h-16 max-w-6xl items-center justify-between rounded-full pl-5 pr-2">
        <Link href="/" aria-label="MedHub" className="shrink-0">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-7 text-sm text-slate-ink md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className={cn(
                  'relative inline-flex items-center gap-1.5 transition-colors hover:text-primary',
                  active === link.href && 'text-primary',
                )}
              >
                {active === link.href && (
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                )}
                {t(link.key)}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <LocaleSwitcher className="hidden sm:inline-flex" />
          <Button asChild variant="secondary" className="hidden sm:inline-flex">
            <Link href="/connexion">{t('signIn')}</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('openMenu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </nav>
      {open && (
        <div className="glass mx-auto mt-2 max-w-6xl rounded-2xl p-4 md:hidden">
          <ul className="grid gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[15px] hover:bg-white/70"
                >
                  {t(link.key)}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/70 pt-3">
            <LocaleSwitcher />
            <Button asChild>
              <Link href="/connexion">{t('signIn')}</Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
