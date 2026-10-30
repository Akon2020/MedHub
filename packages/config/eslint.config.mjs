import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Pure packages (shared, domain, conventions, forms) must stay isomorphic:
 * no Node built-ins, no Next.js, no Dexie, no DOM-only APIs.
 */
export const pureBoundaries = {
  files: ['src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['node:*', 'fs', 'path', 'crypto', 'os', 'child_process'],
            message: 'Pure package: no Node.js built-ins.',
          },
          {
            group: ['next', 'next/*', 'react', 'react-dom'],
            message: 'Pure package: no UI framework.',
          },
          {
            group: ['dexie', 'dexie-*', '@medhub/local-db', '@medhub/db'],
            message: 'Pure package: no storage dependency.',
          },
        ],
      },
    ],
  },
};

export const base = tseslint.config(
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'migrations/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.es2023 } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);

export default base;
