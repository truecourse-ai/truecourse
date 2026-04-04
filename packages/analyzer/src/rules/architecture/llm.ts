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
    key: 'architecture/llm/missing-layers',
    category: 'service',
    domain: 'architecture',
    name: 'Service missing expected architectural layers',
    description: 'Check whether each service has the expected architectural layers for its type.',
    prompt:
      'Check whether each service has the expected architectural layers for its type. An API server should typically have an api layer and a service layer. A service with a data layer should usually have a service layer mediating access. Flag services that are missing layers that would be expected given their role and dependencies.',
    enabled: true,
    severity: 'low',
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
  {
    key: 'architecture/llm/deep-inheritance-chain',
    category: 'module',
    domain: 'architecture',
    name: 'Deep inheritance chain',
    description: 'Class extending 3+ levels deep.',
    prompt:
      'Identify classes with deep inheritance chains (3 or more levels of extends). Deep inheritance makes code fragile — changes in base classes ripple unpredictably. Flag the full chain and suggest composition over inheritance where appropriate.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'architecture/llm/excessive-fan-out',
    category: 'module',
    domain: 'architecture',
    name: 'Excessive fan-out',
    description: 'Module importing too many other modules.',
    prompt:
      'Identify modules that import too many other modules (high fan-out). A module with many outgoing dependencies is tightly coupled to the rest of the codebase and hard to change in isolation. Flag modules importing from more than 8-10 other internal modules and suggest extracting responsibilities.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'architecture/llm/excessive-fan-in',
    category: 'module',
    domain: 'architecture',
    name: 'Excessive fan-in',
    description: 'Module imported by too many others.',
    prompt:
      'Identify modules imported by a disproportionately high number of other modules (high fan-in). These are bottleneck modules where any change has a large blast radius. Flag such modules and assess whether they should be split into smaller, more focused interfaces.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'architecture/llm/mixed-abstraction-levels',
    category: 'module',
    domain: 'architecture',
    name: 'Mixed abstraction levels',
    description: 'Method mixing high-level orchestration with low-level details.',
    prompt:
      'Identify methods that mix different abstraction levels — e.g., a function that both orchestrates high-level workflow (calling other services, managing transactions) and performs low-level operations (string manipulation, raw SQL, bit operations). Each function should operate at a single level of abstraction. Flag methods where you see this mixing and suggest how to separate concerns.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
]
