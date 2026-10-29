import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
