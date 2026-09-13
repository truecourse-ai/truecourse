import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    conditions: command === 'serve'
      ? ['truecourse-source', ...defaultClientConditions]
      : [...defaultClientConditions],
    alias: {
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
