import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The suite is split into affected-only domain projects so a change in one area
// doesn't force the others to re-run (turbo hashes each domain's inputs — see
// turbo.json `//#test:<domain>` tasks). Every node project loads `tests/setup.ts`
// for the global hermetic-env guards; the parser-dependent ones additionally load
// `tests/setup-parsers.ts` (tree-sitter WASM). `pnpm vitest run --project <name>`
// runs a single domain.
//
//   shared        — schemas, spec-consolidator, contract-extractor (ohm .tc parser)   [no tree-sitter]
//   guard         — guard-generator, guard-runner                                      [no tree-sitter]
//   analyzer      — analyzer + contract-verifier extractors                            [tree-sitter]
//   cli           — CLI commands (analyze/guard/…)                                      [tree-sitter]
//   server        — core services, dashboard-server, github-app, ee-* stores           [tree-sitter]
//   architecture  — open-core import-boundary guard (scans all OSS source)             [no tree-sitter]
//   client        — dashboard React UI (jsdom + @testing-library/react)
const GLOBAL_SETUP = './tests/setup.ts';
const PARSER_SETUP = './tests/setup-parsers.ts';
const COMMON_EXCLUDE = ['tests/fixtures/**', '**/node_modules/**', '**/dist/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['tests/{shared,spec-consolidator,contract-extractor}/**/*.test.ts'],
          exclude: COMMON_EXCLUDE,
          testTimeout: 30000,
          setupFiles: [GLOBAL_SETUP],
        },
      },
      {
        test: {
          name: 'guard',
          environment: 'node',
          include: ['tests/{guard-generator,guard-runner}/**/*.test.ts'],
          exclude: COMMON_EXCLUDE,
          testTimeout: 30000,
          setupFiles: [GLOBAL_SETUP],
        },
      },
      {
        test: {
          name: 'analyzer',
          environment: 'node',
          include: ['tests/{analyzer,contract-verifier}/**/*.test.ts'],
          exclude: COMMON_EXCLUDE,
          testTimeout: 30000,
          setupFiles: [GLOBAL_SETUP, PARSER_SETUP],
        },
      },
      {
        test: {
          name: 'cli',
          environment: 'node',
          include: ['tests/cli/**/*.test.ts'],
          exclude: COMMON_EXCLUDE,
          testTimeout: 30000,
          setupFiles: [GLOBAL_SETUP, PARSER_SETUP],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: [
            'tests/{server,dashboard-server,core,github-app,ee-data-store,ee-llm,ee-server,ee-storage}/**/*.test.ts',
          ],
          exclude: COMMON_EXCLUDE,
          testTimeout: 30000,
          setupFiles: [GLOBAL_SETUP, PARSER_SETUP],
        },
      },
      {
        test: {
          name: 'architecture',
          environment: 'node',
          include: ['tests/architecture/**/*.test.ts'],
          exclude: COMMON_EXCLUDE,
          testTimeout: 30000,
          setupFiles: [GLOBAL_SETUP],
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
          exclude: COMMON_EXCLUDE,
          setupFiles: [GLOBAL_SETUP, './tests/dashboard-client/setup.ts'],
          // jsdom + RTL are fast; the long node timeout would just hide hangs.
          testTimeout: 10000,
        },
      },
    ],
  },
});
