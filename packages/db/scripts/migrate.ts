import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/client';
import { ensureGuards } from '../src/guards';
import { ensureRls } from '../src/rls';
import { isMainModule, migrationsFolder, requireEnv } from './env';
import { seedReferenceData } from './reference-data';

export async function runMigrations(url: string): Promise<void> {
  const { pool, db } = createDb(url, 2);
  try {
    const client = await pool.connect();
    try {
      for (const ext of ['pg_trgm', 'unaccent']) {
        try {
          await client.query(`create extension if not exists ${ext}`);
        } catch {
          console.warn(`Extension ${ext} indisponible : repli applicatif de la recherche floue.`);
        }
      }
    } finally {
      client.release();
    }

    await migrate(db, { migrationsFolder });

    const client2 = await pool.connect();
    try {
      await client2.query('begin');
      const tables = await ensureRls(client2);
      await ensureGuards(client2);
      await client2.query('commit');
      console.warn(`RLS forcée sur ${tables.length} tables.`);
    } catch (error) {
      await client2.query('rollback');
      throw error;
    } finally {
      client2.release();
    }

    await seedReferenceData(db);
  } finally {
    await pool.end();
  }
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const url = process.argv.includes('--test')
    ? requireEnv('TEST_DATABASE_URL')
    : requireEnv('DATABASE_URL');
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      'Production : vérifiez que scripts/migrate.sh a fait la sauvegarde pg_dump préalable.',
    );
  }
  runMigrations(url)
    .then(() => console.warn('Migrations appliquées.'))
    .catch((error: unknown) => {
      console.error('Échec des migrations :', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
