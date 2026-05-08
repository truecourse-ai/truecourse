import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Exclude on-disk fixtures and any cloned/copied repos the eval
    // harness drops under tests/.eval-repos/ — those carry their own
    // (often jest) test files which would crash vitest's discovery.
    exclude: ['tests/fixtures/**', 'tests/.eval-repos/**', 'tests/.llm-sample/**'],
    testTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
  },
});
