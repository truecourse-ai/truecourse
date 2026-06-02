import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Two test projects sharing one `pnpm test` invocation:
//   - node:   the existing suite (analyzer, core, dashboard-server, cli, ...).
//             Boots tree-sitter WASM once via tests/setup.ts.
//   - client: the dashboard React UI. jsdom + @testing-library/react.
// New projects (e.g. an ee/ test project later) just add another entry.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: [
            'tests/fixtures/**',
            // Owned by the `client` project below.
            'tests/dashboard-client/**',
          ],
          testTimeout: 30000,
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'apps/dashboard/client/src'),
          },
        },
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/dashboard-client/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/dashboard-client/setup.ts'],
          // jsdom + RTL are fast; the long node timeout would just hide hangs.
          testTimeout: 10000,
        },
      },
    ],
  },
});
