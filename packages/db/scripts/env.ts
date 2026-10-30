import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: [resolve(root, '.env.local'), resolve(root, '.env')], quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Variable d'environnement manquante : ${name} (voir guide.md)`);
    process.exit(1);
  }
  return value;
}

// Development: packages/db/migrations. Release: migrate.js sits inside the migrations folder.
export const migrationsFolder =
  process.env.MEDHUB_MIGRATIONS_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

/** True when the file is the process entry point (tsx in development, bundled in a release). */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(entry).href === moduleUrl;
}
