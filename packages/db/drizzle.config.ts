import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: ['../../.env.local', '../../.env'], quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://medhub_app@localhost:5432/medhub_dev',
  },
  strict: true,
  verbose: true,
});
