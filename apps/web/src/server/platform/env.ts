import 'server-only';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MEDHUB_BASE_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
  MEDHUB_SESSION_SECRET: z.string().min(32, 'MEDHUB_SESSION_SECRET must be at least 32 characters'),
  MEDHUB_FIELD_MASTER_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'MEDHUB_FIELD_MASTER_KEY must be 32 bytes in base64',
    ),
  MEDHUB_SIGNING_KID: z.string().min(1).optional(),
  MEDHUB_SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
  MEDHUB_SIGNING_PUBLIC_KEY: z.string().min(1).optional(),
  MEDHUB_SIGNING_PREVIOUS_KEYS: z.string().optional(),
  /** X25519 public key of support: devices seal their diagnostic journal for it. */
  MEDHUB_SUPPORT_PUBLIC_KEY: z.string().min(40).max(60).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MEDHUB_SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  MEDHUB_SESSION_ABSOLUTE_DAYS: z.coerce.number().positive().default(7),
  /** Requests slower than this are logged with connection pool statistics. */
  MEDHUB_SLOW_REQUEST_MS: z.coerce.number().int().positive().default(2000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated lazily so that `next build` does not require production secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid environment configuration: ${fields}. See guide.md.`);
    }
    cached = parsed.data;
  }
  return cached;
}
