import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'bun', configGlobs: ['bun.lockb'] },
  { value: 'deno', configGlobs: ['deno.json', 'deno.jsonc', 'deno.lock'] },
  { value: 'cloudflare-workers', configGlobs: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'] },
  {
    value: 'edge',
    configContent: {
      globs: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
      pattern: /runtime:\s*['"]edge['"]/,
    },
  },
];

export const runtimeDetector: ArchitectureDetector = {
  category: 'runtime',
  alternatives: ['node', 'bun', 'deno', 'cloudflare-workers', 'edge'],
  // No alternate-runtime markers ⇒ plain Node.
  detect: (scan, scope) => detectByChoiceSpecs('runtime', scan, SPECS, { scope, absenceValue: 'node' }),
};
