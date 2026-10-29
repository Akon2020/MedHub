/**
 * Stable error codes. The UI translates the code; the message is for logs only
 * and never contains personal or health data.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'MODULE_NOT_ENABLED',
  'INTERNAL_ERROR',
  'CSRF_ORIGIN_MISMATCH',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_TENANT_UNKNOWN',
  'AUTH_TENANT_SUSPENDED',
  'DEVICE_REVOKED',
  'DEVICE_UNKNOWN',
  'SYNC_TENANT_MISMATCH',
  'SYNC_SCHEMA_UNSUPPORTED',
  'SYNC_BATCH_TOO_LARGE',
  'SYNC_UNKNOWN_COMMAND',
  'SYNC_PAYLOAD_INVALID',
  'SYNC_SIGNATURE_INVALID',
  'SYNC_ONLINE_ONLY',
  'SYNC_ENTITY_MISMATCH',
  'DEPENDENCY_REJECTED',
  'VERSION_CONFLICT',
  'PAT_NOT_FOUND',
  'PAT_DUPLICATE_SUSPECTED',
  'PAT_MRN_TAKEN',
  'DPI_VITAL_IMPLAUSIBLE',
  'DPI_SUPERSEDED_NOT_FOUND',
  'PHAR_NEGATIVE_STOCK',
  'IDEMPOTENCY_KEY_REQUIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
