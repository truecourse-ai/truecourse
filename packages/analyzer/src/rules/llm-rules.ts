import type { AnalysisRule } from '@truecourse/shared'

export const LLM_ARCHITECTURE_RULES: AnalysisRule[] = [
  {
    key: 'llm/arch-circular-dependency',
    category: 'service',
    name: 'Circular service dependency',
    description: 'Detect circular dependency chains between services.',
    prompt:
      'Detect circular dependency chains between services. A circular dependency exists when service A depends on service B, and service B (directly or transitively) depends back on service A. Flag any cycles found and list the full dependency chain. Circular dependencies make services harder to deploy independently and create tight coupling.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'llm/arch-god-service',
    category: 'service',
    name: 'God service with too many responsibilities',
    description: 'Identify services that have too many responsibilities.',
    prompt:
      'Identify services that have too many responsibilities. A "god service" typically has a very high file count relative to other services, connects to many other services, spans many layers, or handles unrelated domains. Flag services that appear to do too much and suggest how they could be split.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/arch-tight-coupling',
    category: 'service',
    name: 'Tightly coupled service pair',
    description: 'Identify pairs of services with unusually high cross-dependencies.',
    prompt:
      'Identify pairs of services with an unusually high number of dependencies between them. If two services have many import or HTTP dependencies in both directions, they may be too tightly coupled and could benefit from being merged or having a shared interface extracted. Consider the ratio of cross-service dependencies to total dependencies.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/arch-missing-layers',
    category: 'service',
    name: 'Service missing expected architectural layers',
    description: 'Check whether each service has the expected architectural layers for its type.',
    prompt:
      'Check whether each service has the expected architectural layers for its type. An API server should typically have an api layer and a service layer. A service with a data layer should usually have a service layer mediating access. Flag services that are missing layers that would be expected given their role and dependencies.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
]

export const LLM_DATABASE_RULES: AnalysisRule[] = [
  {
    key: 'llm/db-missing-foreign-key',
    category: 'database',
    name: 'Missing foreign key constraint',
    description: 'Columns ending in _id without FK constraint.',
    prompt:
      'Look for columns ending in `_id` or `Id` that do not have a corresponding foreign key constraint defined. Missing foreign keys allow orphaned records and break referential integrity. Flag each instance with the table and column name.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'llm/db-missing-index',
    category: 'database',
    name: 'Missing index on foreign key column',
    description: 'FK columns without index cause slow queries.',
    prompt:
      'Check whether foreign key columns have an index defined. Foreign key columns without indexes cause slow JOIN queries and lookups. Flag any FK column that appears to lack an index.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/db-naming-inconsistency',
    category: 'database',
    name: 'Inconsistent naming conventions',
    description: 'Mixed naming conventions across tables and columns.',
    prompt:
      'Check for mixed naming conventions across tables and columns. Common inconsistencies include mixing snake_case and camelCase, mixing singular and plural table names, or using inconsistent prefixes. Flag specific examples of inconsistency.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
  {
    key: 'llm/db-missing-timestamps',
    category: 'database',
    name: 'Missing created_at / updated_at columns',
    description: 'Tables missing standard timestamp columns for audit trails.',
    prompt:
      'Check whether tables have `created_at` and `updated_at` (or equivalent) timestamp columns. These are standard for audit trails and debugging. Flag tables that are missing one or both timestamp columns.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
  {
    key: 'llm/db-overly-nullable',
    category: 'database',
    name: 'Too many nullable columns',
    description: 'Tables where a large proportion of columns are nullable.',
    prompt:
      'Identify tables where a large proportion of columns are nullable. Excessive nullability often indicates a poorly normalized schema or optional fields that should be in a separate table. Flag tables where more than half of non-PK columns are nullable.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
]

export const LLM_MODULE_RULES: AnalysisRule[] = [
  {
    key: 'llm/arch-circular-module-dependency',
    category: 'module',
    name: 'Circular module dependency',
    description: 'Circular imports between modules within a service.',
    prompt:
      'Detect circular import chains between modules within the same service. A circular dependency exists when module A imports module B, and module B (directly or transitively) imports module A. Flag any cycles found and list the full dependency chain. Circular module dependencies make refactoring difficult and indicate unclear boundaries.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'llm/arch-deep-inheritance-chain',
    category: 'module',
    name: 'Deep inheritance chain',
    description: 'Class extending 3+ levels deep.',
    prompt:
      'Identify classes with deep inheritance chains (3 or more levels of extends). Deep inheritance makes code fragile — changes in base classes ripple unpredictably. Flag the full chain and suggest composition over inheritance where appropriate.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/arch-excessive-fan-out',
    category: 'module',
    name: 'Excessive fan-out',
    description: 'Module importing too many other modules.',
    prompt:
      'Identify modules that import too many other modules (high fan-out). A module with many outgoing dependencies is tightly coupled to the rest of the codebase and hard to change in isolation. Flag modules importing from more than 8-10 other internal modules and suggest extracting responsibilities.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/arch-excessive-fan-in',
    category: 'module',
    name: 'Excessive fan-in',
    description: 'Module imported by too many others.',
    prompt:
      'Identify modules imported by a disproportionately high number of other modules (high fan-in). These are bottleneck modules where any change has a large blast radius. Flag such modules and assess whether they should be split into smaller, more focused interfaces.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/arch-mixed-abstraction-levels',
    category: 'module',
    name: 'Mixed abstraction levels',
    description: 'Method mixing high-level orchestration with low-level details.',
    prompt:
      'Identify methods that mix different abstraction levels — e.g., a function that both orchestrates high-level workflow (calling other services, managing transactions) and performs low-level operations (string manipulation, raw SQL, bit operations). Each function should operate at a single level of abstraction. Flag methods where you see this mixing and suggest how to separate concerns.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
]
