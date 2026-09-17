import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

// React Router's plugin carries React Fast Refresh itself; a second React
// plugin injects the refresh runtime twice and the page's script dies on load.
export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3100,
  },
});
