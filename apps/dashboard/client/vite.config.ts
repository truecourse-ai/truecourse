import fs from 'node:fs';
import path from 'node:path';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(__dirname, '../../..');

/**
 * The edition module `main.tsx` imports: the enterprise bundle when this
 * checkout has one, the open edition's no-op when it does not. The edition is
 * decided here, at build time, so the app carries no loader and no branch.
 */
const eeEdition = path.resolve(repoRoot, 'ee/packages/client/src/edition.tsx');
const edition = fs.existsSync(eeEdition)
  ? eeEdition
  : path.resolve(__dirname, './src/dashboard/shell/open-edition.ts');

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  // The client reads the same repo-root `.env` the server does.
  envDir: repoRoot,
  // One switch for both halves: `POSTHOG_DISABLED=1` in that file (or the build
  // environment) also turns the client off, unless the client's own flag is set.
  define: {
    'import.meta.env.VITE_POSTHOG_DISABLED': JSON.stringify(
      loadEnv(mode, repoRoot, '').VITE_POSTHOG_DISABLED ??
        process.env.VITE_POSTHOG_DISABLED ??
        loadEnv(mode, repoRoot, '').POSTHOG_DISABLED ??
        process.env.POSTHOG_DISABLED ??
        '',
    ),
  },
  resolve: {
    conditions: command === 'serve'
      ? ['truecourse-source', ...defaultClientConditions]
      : [...defaultClientConditions],
    alias: {
      '@edition': edition,
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Allow serving workspace sources, which live outside the client root.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: 'dist',
  },
}));
