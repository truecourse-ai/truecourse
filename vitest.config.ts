import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    env: {
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5435/truecourse_test',
    },
    globalSetup: ['tests/global-setup.ts'],
  },
});
