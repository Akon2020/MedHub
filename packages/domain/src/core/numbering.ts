/**
 * Offline numbering templates (docs/02-offline-sync.md section 10). Any template
 * used offline must contain {DEVICE} so that two workstations can never issue
 * the same number.
 */
export const DEFAULT_MRN_TEMPLATE = '{PREFIX}-{DEVICE}-{YY}-{SEQ:5}';
export const DEFAULT_DOCUMENT_TEMPLATE = '{SITE}-{DEVICE}-{YYYY}-{SEQ:6}';

export type NumberingValues = {
  prefix?: string;
  site?: string;
  device: string;
  year: number;
  seq: number;
};

export function isOfflineSafeTemplate(template: string): boolean {
  return template.includes('{DEVICE}') && /\{SEQ(:\d+)?\}/.test(template);
}

export function formatNumber(template: string, values: NumberingValues): string {
  return template.replace(
    /\{(PREFIX|SITE|DEVICE|YYYY|YY|SEQ)(?::(\d+))?\}/g,
    (_m, token: string, width?: string) => {
      switch (token) {
        case 'PREFIX':
          return values.prefix ?? '';
        case 'SITE':
          return values.site ?? '';
        case 'DEVICE':
          return values.device;
        case 'YYYY':
          return String(values.year);
        case 'YY':
          return String(values.year % 100).padStart(2, '0');
        default:
          return String(values.seq).padStart(Number(width ?? 1), '0');
      }
    },
  );
}
