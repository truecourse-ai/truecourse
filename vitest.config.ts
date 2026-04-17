import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    testTimeout: 30000,
    // Each test file opens its own in-memory PGlite via setupTestDb(); run in
    // forked processes so the `db` singleton in apps/server doesn't race.
    pool: 'forks',
  },
});
