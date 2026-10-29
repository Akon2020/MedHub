import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const here = dirname(fileURLToPath(import.meta.url));
// Development reads the monorepo root .env.local; production uses the host environment.
loadEnv({ path: [resolve(here, '../../.env.local'), resolve(here, '../../.env')], quiet: true });

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(here, '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@medhub/shared',
    '@medhub/domain',
    '@medhub/sync',
    '@medhub/local-db',
    '@medhub/db',
  ],
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'pino'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
