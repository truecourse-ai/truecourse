import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror apps/web/vite.config.ts so tests for web layout utilities
      // resolve the `@/…` import paths used in web source files.
      '@': path.resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    testTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
  },
});
