import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/smoke/**/*.smoke.test.ts'],
    exclude: ['test/smoke/fixtures/**'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    sequence: { sequential: true },
    globalSetup: ['test/smoke/globalSetup.ts'],
  },
});
