import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');

export default defineConfig(({ mode }) => {
  // Whether the enterprise client code is included in this build. On in
  // dev and when explicitly building the enterprise artifact; OFF for a
  // plain production (community) build, so the ee chunk is tree-shaken
  // out entirely and never shipped to community users.
  const includeEe = mode !== 'production' || process.env.VITE_TC_EE === 'true';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_TC_EE': JSON.stringify(includeEe),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Resolve the enterprise client to its source (not the
        // node_modules symlink) so Vite's React plugin transforms its
        // TSX — the plugin skips node_modules. The OSS client only ever
        // reaches this module via a gated dynamic import; this alias is
        // config, not a source import, so the open-core boundary holds.
        '@truecourse/ee-client': path.resolve(
          repoRoot,
          'ee/packages/client/src/index.tsx',
        ),
      },
    },
    server: {
      // Allow serving the ee/ source, which lives outside the client root.
      fs: { allow: [repoRoot] },
    },
    build: {
      outDir: 'dist',
    },
  };
});
