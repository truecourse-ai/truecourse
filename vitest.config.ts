import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    testTimeout: 30000,
    hookTimeout: 600000,
    setupFiles: ['./tests/setup.ts'],
  },
});
