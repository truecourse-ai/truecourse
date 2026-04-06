import type { AnalysisRule } from '@truecourse/shared'

export const ARCHITECTURE_DETERMINISTIC_RULES: AnalysisRule[] = [
  // Service-level deterministic rules
  {
    key: 'architecture/deterministic/circular-service-dependency',
    category: 'service',
    domain: 'architecture',
    name: 'Circular service dependency',
    description: 'Two services depend on each other, creating a circular dependency.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
    isDependencyViolation: true,
  },
  {
    key: 'architecture/deterministic/god-service',
    category: 'service',
    domain: 'architecture',
    name: 'God service',
    description: 'Service has too many files or spans too many layers, suggesting too many responsibilities.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },

  // Module-level deterministic rules
  {
    key: 'architecture/deterministic/data-layer-depends-on-api',
    category: 'module',
    domain: 'architecture',
    name: 'Data layer depends on API layer',
    description: 'Data layer should not import from the API layer.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
    isDependencyViolation: true,
  },

  // Code-level deterministic rules (AST visitors)
  {
    key: 'architecture/deterministic/declarations-in-global-scope',
    category: 'code',
    domain: 'architecture',
    name: 'Global scope declaration',
    description: 'Mutable variable declared in global/module scope.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'architecture/deterministic/barrel-file-re-export-all',
    category: 'code',
    domain: 'architecture',
    name: 'Barrel file with many re-exports',
    description: "index.ts with many 'export *' re-exports can slow down bundlers.",
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
]
