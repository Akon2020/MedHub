// `pnpm dev`: checks that PostgreSQL answers (starting the Docker one if available), then runs Next.js.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = join(root, '.env.local');

if (!existsSync(envFile)) {
  console.error(
    'Fichier .env.local absent. Copiez .env.example en .env.local puis remplissez-le (voir guide.md).',
  );
  process.exit(1);
}

const pg = await import('pg').catch(() => null);
const { config } = await import('dotenv');
config({ path: envFile, quiet: true });

async function databaseReachable() {
  if (!pg || !process.env.DATABASE_URL) return false;
  const client = new pg.default.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (!(await databaseReachable())) {
  const docker = spawnSync(
    'docker',
    ['compose', '-f', join(root, 'infra/docker/docker-compose.yml'), 'up', '-d'],
    {
      stdio: 'inherit',
    },
  );
  if (docker.status !== 0) {
    console.warn(
      'PostgreSQL injoignable et Docker indisponible : démarrez votre PostgreSQL local (voir guide.md).',
    );
  }
}

const child = spawn('pnpm', ['--filter', '@medhub/web', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
