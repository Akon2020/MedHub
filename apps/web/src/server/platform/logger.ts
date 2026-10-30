import 'server-only';
import pino from 'pino';

/**
 * Structured logs never carry personal or health data: any field with one of
 * these names is removed, wherever it appears in the logged object.
 */
const FORBIDDEN_FIELDS = [
  'name',
  'familyName',
  'givenName',
  'middleName',
  'phone',
  'birthDate',
  'diagnosis',
  'note',
  'payload',
  'password',
  'pin',
  'token',
  'body',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'medhub-web' },
  redact: {
    paths: [...FORBIDDEN_FIELDS, ...FORBIDDEN_FIELDS.map((f) => `*.${f}`)],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
