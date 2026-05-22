import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// In dev, `pnpm dev` should export PORT once at the turbo level so both the
// dashboard server and this proxy agree. Default mirrors DEFAULT_PORT_CANDIDATES[0]
// in @truecourse/core/lib/port for the case where PORT is unset.
const apiPort = process.env.PORT || '47821';
const apiTarget = `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
