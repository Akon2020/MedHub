import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Sora } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ServiceWorkerRegistrar } from '@/client/service-worker';
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
  themeColor: '#0f6b6b',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${body.variable} ${heading.variable}`}>
      <body className="min-h-dvh font-sans">
        <NextIntlClientProvider>
          {children}
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
