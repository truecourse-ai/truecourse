import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  {
    value: 'serverless',
    configGlobs: ['serverless.yml', 'serverless.yaml', 'sam.yaml', 'sam.yml', 'template.yaml'],
  },
  {
    value: 'modular-monolith',
    configGlobs: ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'],
  },
];

export const architectureStyleDetector: ArchitectureDetector = {
  category: 'architecture-style',
  alternatives: ['monolith', 'modular-monolith', 'microservices', 'serverless'],
  // No serverless/workspace markers ⇒ a plain single-deploy monolith.
  detect: (scan, scope) =>
    detectByChoiceSpecs('architecture-style', scan, SPECS, { scope, absenceValue: 'monolith' }),
};
