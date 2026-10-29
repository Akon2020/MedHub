// Builds the versioned archive deployed on cPanel (docs/09-hebergement-deploiement.md section 4).
// Must run on Linux x64 (the CI does it) so that native modules match the server.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(root, 'apps/web');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().slice(0, 10);
const name = `medhub-${version}`;
const out = join(root, 'release', name);

const required = [
  join(web, '.next/standalone'),
  join(web, '.next/static'),
  join(web, 'public/sw.js'),
  join(root, 'apps/worker/dist/index.js'),
];
for (const path of required) {
  if (!existsSync(path)) {
    console.error(`Missing build output: ${path}. Run "pnpm build" first.`);
    process.exit(1);
  }
}
if (process.platform !== 'linux') {
  console.warn('Warning: building a release outside Linux; native modules may not run on cPanel.');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// web/: standalone server with static assets and public files placed where server.js expects them.
cpSync(join(web, '.next/standalone'), join(out, 'web'), { recursive: true, dereference: true });
cpSync(join(web, '.next/static'), join(out, 'web/apps/web/.next/static'), { recursive: true });
cpSync(join(web, 'public'), join(out, 'web/apps/web/public'), { recursive: true });
// The standalone server is an ES module; Passenger loads its startup file with require(),
// so the cPanel "Application startup file" is this CommonJS shim.
writeFileSync(join(out, 'web/app.cjs'), "import('./apps/web/server.js');\n");

// worker/: single bundled file run by cron.
mkdirSync(join(out, 'worker'), { recursive: true });
cpSync(join(root, 'apps/worker/dist/index.js'), join(out, 'worker/index.js'));
writeFileSync(join(out, 'worker/package.json'), '{ "type": "module" }\n');

// migrations/: SQL files plus a bundled migrator.
cpSync(join(root, 'packages/db/migrations'), join(out, 'migrations'), { recursive: true });
await build({
  entryPoints: [join(root, 'packages/db/scripts/migrate.ts')],
  outfile: join(out, 'migrations/migrate.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@node-rs/argon2', 'pg-native'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});

// scripts/: deployment helpers.
cpSync(join(root, 'infra/cpanel'), join(out, 'scripts'), { recursive: true });
writeFileSync(join(out, 'VERSION'), `${version}\n${stamp}\n`);

const archive = join(root, 'release', `${name}.tar.gz`);
// Relative paths: GNU tar on Windows would read a drive letter as a remote host.
execFileSync('tar', ['-czf', `${name}.tar.gz`, name], {
  cwd: join(root, 'release'),
  stdio: 'inherit',
});
console.warn(`Release ready: ${archive}`);
