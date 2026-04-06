import type { AnalysisRule } from '@truecourse/shared'

export const ARCHITECTURE_LLM_RULES: AnalysisRule[] = [
  {
    key: 'architecture/llm/tight-coupling',
    category: 'service',
    domain: 'architecture',
    name: 'Tightly coupled service pair',
    description: 'Identify pairs of services with unusually high cross-dependencies.',
    prompt:
      'Identify pairs of services with an unusually high number of dependencies between them. If two services have many import or HTTP dependencies in both directions, they may be too tightly coupled and could benefit from being merged or having a shared interface extracted. Consider the ratio of cross-service dependencies to total dependencies.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'architecture/llm/circular-module-dependency',
    category: 'module',
    domain: 'architecture',
    name: 'Circular module dependency',
    description: 'Circular imports between modules within a service.',
    prompt:
      'Detect circular import chains between modules within the same service. A circular dependency exists when module A imports module B, and module B (directly or transitively) imports module A. Flag any cycles found and list the full dependency chain. Circular module dependencies make refactoring difficult and indicate unclear boundaries.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
]
