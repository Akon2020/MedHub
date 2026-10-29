import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Module boundaries from CLAUDE.md section 4. Operational screens and features
 * never reach server code; withPlatformScope stays inside platform and sadm.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next-e2e/**',
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/sw.js',
    'src/sw.ts',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/app/app/**', 'src/features/**', 'src/client/**', 'src/components/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/*', '**/server/**'],
              message: 'Client code must not import server code.',
            },
            {
              group: ['@medhub/db', '@medhub/db/*'],
              message: 'Client code must not import the server database.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/**'],
    ignores: ['src/server/platform/**', 'src/server/modules/sadm/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@medhub/db',
              importNames: ['withPlatformScope'],
              message: 'withPlatformScope is reserved to platform and sadm.',
            },
          ],
          patterns: [
            {
              group: ['@medhub/local-db', '@/client/*'],
              message: 'Server code never imports browser storage.',
            },
          ],
        },
      ],
    },
  },
]);
