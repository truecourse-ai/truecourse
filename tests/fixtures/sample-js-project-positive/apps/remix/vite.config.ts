
// --- FP shape: plugin config object with async function property ---
declare function createServerAdapter(opts: {
  getLoadContext: (req: { headers: Record<string, string> }) => Promise<Record<string, unknown>>;
}): unknown;

const adapter = createServerAdapter({
  getLoadContext: async (req) => {
    return { userAgent: req.headers['user-agent'] };
  },
});



declare const devServerDefaults: { exclude: (string | RegExp)[] };
declare function defineConfig(cfg: unknown): unknown;
declare function remixDevServer(opts: unknown): unknown;

// Vite import query regex used in exclude list — ASCII query params, unicode flag unnecessary.
const viteConfig = defineConfig({
  plugins: [
    remixDevServer({
      exclude: [
        ...devServerDefaults.exclude.map((pattern: string | RegExp) =>
          pattern instanceof RegExp && pattern.source === '.*\.css$'
            ? /^(?!\/api\/static\/).*\.css$/
            : pattern,
        ),
        '/assets/**',
        /\?(?:inline|url|no-inline|raw|import(?:&(?:inline|url|no-inline|raw)?)?)$/,
      ],
    }),
  ],
});

export default viteConfig;



declare function defineConfig(cfg: unknown): unknown;

// Simple word match /playwright/ for Vite config exclusion — ASCII literal, unicode flag irrelevant.
const viteProductionConfig = defineConfig({
  build: {
    rollupOptions: {
      external: [
        /playwright/,
        '@playwright/browser-chromium',
        'skia-canvas',
      ],
    },
  },
});

export default viteProductionConfig;
