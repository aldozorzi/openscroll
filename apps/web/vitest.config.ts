import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
