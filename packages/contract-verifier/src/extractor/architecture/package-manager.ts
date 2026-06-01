import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'pnpm', configGlobs: ['pnpm-lock.yaml'] },
  { value: 'yarn', configGlobs: ['yarn.lock'] },
  { value: 'bun', configGlobs: ['bun.lockb'] },
  { value: 'npm', configGlobs: ['package-lock.json'] },
];

export const packageManagerDetector: ArchitectureDetector = {
  category: 'package-manager',
  alternatives: ['npm', 'yarn', 'pnpm', 'bun'],
  // No lockfile ⇒ undeterminable.
  detect: (scan, scope) => detectByChoiceSpecs('package-manager', scan, SPECS, { scope }),
};
