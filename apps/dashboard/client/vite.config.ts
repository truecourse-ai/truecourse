import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

const repoRoot = path.resolve(__dirname, '../../..');
const eeClientEntry = path.resolve(repoRoot, 'ee/packages/client/src/index.tsx');
// The enterprise overlay is optional: a community checkout has no `ee/`.
const eePresent = fs.existsSync(eeClientEntry);

export default defineConfig(({ mode }) => {
  // Whether the enterprise client code is included in this build. Requires
  // the ee overlay to be present, and is on in dev or an explicit enterprise
  // build; a plain production (community) build leaves it off so the ee chunk
  // is tree-shaken out and never shipped to community users.
  const includeEe = eePresent && (mode !== 'production' || process.env.VITE_TC_EE === 'true');

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_TC_EE': JSON.stringify(includeEe),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Resolve the enterprise client to its source (not the node_modules
        // symlink) so Vite's React plugin transforms its TSX — the plugin
        // skips node_modules. The OSS client only ever reaches this via a
        // gated dynamic import; the alias is config, not a source import, so
        // the open-core boundary holds. Only registered when ee/ exists, so a
        // community build never tries to resolve the (absent) module.
        ...(eePresent ? { '@truecourse/ee-client': eeClientEntry } : {}),
      },
    },
    server: {
      // Allow serving the ee/ source, which lives outside the client root.
      fs: { allow: [repoRoot] },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        // Without the ee overlay there's nothing to resolve for the gated
        // dynamic import; mark it external so the community build doesn't try
        // to bundle it. The import is dead code when `includeEe` is false, so
        // it's never executed at runtime.
        external: eePresent ? [] : ['@truecourse/ee-client'],
      },
    },
  };
});
