import 'server-only';
import { createDb, type DbHandle } from '@medhub/db';
import { env } from './env';

const globalForDb = globalThis as unknown as { medhubDb?: DbHandle };

/** One pool per process, kept across hot reloads in development. */
export function database(): DbHandle {
  if (!globalForDb.medhubDb) {
    const config = env();
    globalForDb.medhubDb = createDb(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  }
  return globalForDb.medhubDb;
}
