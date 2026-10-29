import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '@medhub/db';
import { config } from 'dotenv';
import { runTick } from './tick';

const here = dirname(fileURLToPath(import.meta.url));
config({
  path: [resolve(here, '../../../.env.local'), resolve(here, '../../../.env')],
  quiet: true,
});

async function main(): Promise<number> {
  const command = process.argv[2];
  if (command !== 'tick') {
    console.error('Usage: node worker/index.js tick');
    return 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    return 1;
  }
  const handle = createDb(url, 3);
  try {
    const result = await runTick(handle, {
      log: (message) =>
        console.log(JSON.stringify({ at: new Date().toISOString(), worker: message })),
    });
    console.log(JSON.stringify({ at: new Date().toISOString(), tick: result }));
    return 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
    return 1;
  } finally {
    await handle.pool.end();
  }
}

main().then((code) => process.exit(code));
