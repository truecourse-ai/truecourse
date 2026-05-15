import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@truecourse/analyzer': fileURLToPath(new URL('./packages/analyzer/src/index.ts', import.meta.url)),
      '@truecourse/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@truecourse/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    testTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
  },
});
