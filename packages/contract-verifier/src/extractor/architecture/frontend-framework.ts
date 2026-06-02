import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'react', packages: ['react'], imports: ['react'] },
  { value: 'vue', packages: ['vue'], imports: ['vue'] },
  { value: 'svelte', packages: ['svelte'], configGlobs: ['svelte.config.js', 'svelte.config.ts'] },
  { value: 'angular', packages: ['@angular/core'] },
  { value: 'solid', packages: ['solid-js'] },
  { value: 'htmx', packages: ['htmx.org'] },
];

export const frontendFrameworkDetector: ArchitectureDetector = {
  category: 'frontend-framework',
  alternatives: [...SPECS.map((s) => s.value), 'none'],
  detect: (scan, scope) =>
    detectByChoiceSpecs('frontend-framework', scan, SPECS, { scope, absenceValue: 'none' }),
};
