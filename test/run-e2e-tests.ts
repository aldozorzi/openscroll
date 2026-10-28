import 'dotenv/config';
import { getSharedTestDb, destroySharedTestDb } from '../packages/db/src/test-db';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  console.log('Setting up E2E test database...');
  const handle = await getSharedTestDb();
  console.log(`E2E test database ready: ${handle.dbName}`);

  // Write test env file for config package
  const envFile = join(tmpdir(), 'openscroll-test-env.json');
  writeFileSync(envFile, JSON.stringify({
    DATABASE_URL: handle.url,
    DIRECT_URL: handle.directUrl,
  }));

  process.env.DATABASE_URL = handle.url;
  process.env.DIRECT_URL = handle.directUrl;
  process.env.OPENSCROLL_USE_TEST_DB = 'true';

  // Never let E2E mail a real address. A dummy key keeps production-mode
  // configuration valid (registration would otherwise return 503) while all
  // Resend calls fail harmlessly. Tests mint verification/reset tokens
  // directly in the test database instead.
  const dummyResendKey =
    process.env.E2E_RESEND_API_KEY ?? 're_e2e_not_a_real_key';
  const runtimeEnv = {
    // Production mode rejects the development placeholders from .env.
    AUTH_SECRET: 'e2e-auth-secret-0123456789abcdef0123456789abcdef',
    CRON_SECRET: 'e2e-cron-secret-0123456789abcdef0123456789abcdef',
    ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef0123456789abcdef',
    RESEND_API_KEY: dummyResendKey,
    RESEND_VERIFICATION_API_KEY: dummyResendKey,
    EMAIL_FROM: 'OpenScroll <e2e@example.com>',
    EMAIL_VERIFICATION_FROM: 'OpenScroll <e2e-verify@example.com>',
  };

  // Run Playwright tests from web package
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('corepack', ['pnpm', '--filter', '@openscroll/web', 'exec', 'playwright', 'test'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...runtimeEnv,
      DATABASE_URL: handle.url,
      DIRECT_URL: handle.directUrl,
      OPENSCROLL_USE_TEST_DB: 'true',
    },
  });

  console.log('Cleaning up E2E test database...');
  await destroySharedTestDb();

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});