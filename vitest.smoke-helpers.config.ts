import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/smoke/helpers/*.test.ts'],
    testTimeout: 10_000,
  },
});
