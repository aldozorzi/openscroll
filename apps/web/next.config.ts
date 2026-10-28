import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

loadEnv({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  quiet: true,
});

const standalone = process.env.NEXT_STANDALONE !== 'false';

const config: NextConfig = {
  ...(standalone ? { output: 'standalone' as const } : {}),
  allowedDevOrigins: ['192.168.8.*'],
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
  transpilePackages: [
    '@openscroll/ai',
    '@openscroll/config',
    '@openscroll/contracts',
    '@openscroll/db',
    '@openscroll/fsrs',
    '@openscroll/ingest',
    '@openscroll/queue',
    '@openscroll/recommendation',
  ],
  poweredByHeader: false,
};

export default config;
