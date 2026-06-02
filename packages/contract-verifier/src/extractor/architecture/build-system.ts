import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'vite', configGlobs: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.*'] },
  { value: 'webpack', configGlobs: ['webpack.config.js', 'webpack.config.ts', 'webpack.config.*'] },
  { value: 'rollup', configGlobs: ['rollup.config.js', 'rollup.config.ts', 'rollup.config.*'] },
  { value: 'esbuild', packages: ['esbuild'], configGlobs: ['esbuild.config.js', 'esbuild.config.ts'] },
  { value: 'parcel', packages: ['parcel'] },
  { value: 'tsc-only', configGlobs: ['tsconfig.json'] },
];

export const buildSystemDetector: ArchitectureDetector = {
  category: 'build-system',
  alternatives: [...SPECS.map((s) => s.value), 'turbopack', 'bun-bundler'],
  // No absence value: a repo with no build config AND no tsconfig is
  // genuinely undeterminable → `inconclusive`, not a false unmet-choice.
  detect: (scan, scope) => detectByChoiceSpecs('build-system', scan, SPECS, { scope }),
};
