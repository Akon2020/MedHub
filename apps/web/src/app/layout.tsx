import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Sora } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ServiceWorkerRegistrar } from '@/client/service-worker';
import { DEFAULT_THEME, THEME_COOKIE, isTheme, themeAttribute } from '@/lib/theme';
import './globals.css';

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const heading = Sora({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: t('title'), template: '%s · MedHub' },
    description: t('description'),
    applicationName: 'MedHub',
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icons/icon.svg', apple: '/icons/icon.svg' },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f6b6b' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1515' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(stored) ? stored : DEFAULT_THEME;
  return (
    <html
      lang={locale}
      data-theme={themeAttribute(theme)}
      className={`${body.variable} ${heading.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans">
        <NextIntlClientProvider>
          {children}
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
