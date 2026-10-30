import { defineConfig } from 'tsup';

/** Single self-contained file run by cron: `node worker/index.js tick`. */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  bundle: true,
  // Everything is bundled except native modules; the worker never hashes passwords.
  noExternal: [/^(?!@node-rs\/argon2|pg-native).*/],
  external: ['@node-rs/argon2', 'pg-native'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
