import { base } from '@medhub/config/eslint';

export default [
  ...base,
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
