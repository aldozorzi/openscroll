import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    globalSetup: ['./test/global-setup.ts'],
    globalTeardown: ['./test/global-teardown.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    env: {
      NODE_ENV: 'test',
    },
  },
});