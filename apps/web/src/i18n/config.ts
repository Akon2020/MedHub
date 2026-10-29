export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Formatting locale: Congolese French formats amounts and dates the local way. */
export function formattingLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-CD' : 'en';
}
