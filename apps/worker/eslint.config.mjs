import { base } from '@medhub/config/eslint';

export default [...base, { files: ['src/index.ts'], rules: { 'no-console': 'off' } }];
