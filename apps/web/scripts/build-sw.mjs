// Bundles src/sw.ts into public/sw.js after `next build` and injects the precache
// manifest: hashed static assets plus the offline application shell routes.
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '.next', 'static');
const SHELL_ROUTES = [
  '/app',
  '/app/patients',
  '/app/patients/fiche',
  '/app/diagnostic',
  '/app/bientot',
  '/connexion',
  '/connexion/activation',
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const buildId = (await readFile(join(root, '.next', 'BUILD_ID'), 'utf8')).trim();
const assets = (await walk(staticDir))
  .filter((file) => !file.endsWith('.map'))
  .map((file) => ({
    url: `/_next/static/${relative(staticDir, file).split('\\').join('/')}`,
    revision: null,
  }));
const shell = SHELL_ROUTES.map((url) => ({ url, revision: buildId }));
const manifest = [
  ...shell,
  ...assets,
  { url: '/manifest.webmanifest', revision: buildId },
  { url: '/icons/icon.svg', revision: buildId },
];

await build({
  entryPoints: [join(root, 'src', 'sw.ts')],
  outfile: join(root, 'public', 'sw.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  define: { 'self.__SW_MANIFEST': JSON.stringify(manifest) },
  logLevel: 'warning',
});

const totalBytes = (
  await Promise.all(
    (await walk(staticDir))
      .filter((f) => !f.endsWith('.map'))
      .map(async (f) => (await stat(f)).size),
  )
).reduce((a, b) => a + b, 0);
console.warn(
  `sw.js: ${manifest.length} precache entries, static assets ${(totalBytes / 1024).toFixed(0)} KiB uncompressed`,
);
