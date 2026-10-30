'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  DEFAULT_THEME,
  THEME_COOKIE,
  THEMES,
  isTheme,
  themeAttribute,
  type Theme,
} from '@/lib/theme';
import { cn } from '@/lib/utils';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function readCookie(): Theme {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${THEME_COOKIE}=`));
  const value = match?.slice(THEME_COOKIE.length + 1);
  return isTheme(value) ? value : DEFAULT_THEME;
}

function persist(theme: Theme): void {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function apply(theme: Theme): void {
  const attribute = themeAttribute(theme);
  if (attribute) document.documentElement.dataset.theme = attribute;
  else delete document.documentElement.dataset.theme;
}

/**
 * The cookie lets the server render the right theme on the first paint. The
 * effect re-applies it for pages served from the offline cache, whose HTML may
 * predate the last change.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common.theme');
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = readCookie();
    apply(stored);
    // Reading the cookie is only possible after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
  }, []);

  function choose(next: Theme) {
    persist(next);
    apply(next);
    setTheme(next);
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full bg-card/70 p-1 ring-1 ring-border',
        className,
      )}
    >
      {THEMES.map((code) => {
        const Icon = ICONS[code];
        return (
          <button
            key={code}
            type="button"
            onClick={() => choose(code)}
            aria-pressed={theme === code}
            title={t(code)}
            className={cn(
              'grid size-7 place-items-center rounded-full transition-colors',
              theme === code
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{t(code)}</span>
          </button>
        );
      })}
    </div>
  );
}
