'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { apiFetch } from '@/client/api';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

function persistLocale(next: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * With `account`, the choice is also saved on the signed-in account so that it
 * follows the user to other devices; offline, the device keeps it until then.
 */
export function LocaleSwitcher({ className, account }: { className?: string; account?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    persistLocale(next);
    if (account && navigator.onLine) {
      void apiFetch('/api/v1/account/locale', {
        method: 'POST',
        body: JSON.stringify({ locale: next }),
      }).catch(() => undefined);
    }
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full bg-card/70 p-1 ring-1 ring-border',
        className,
      )}
    >
      <Languages className="mx-1 size-3.5 text-muted-foreground" aria-hidden />
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          disabled={pending}
          onClick={() => choose(code)}
          aria-pressed={locale === code}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-semibold uppercase transition-colors',
            locale === code
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
