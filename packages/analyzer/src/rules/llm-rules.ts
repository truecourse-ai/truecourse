import type { AnalysisRule } from '@truecourse/shared'

export const LLM_ARCHITECTURE_RULES: AnalysisRule[] = [
  {
    key: 'llm/arch-circular-dependency',
    category: 'architecture',
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
    category: 'architecture',
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
    category: 'architecture',
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
    category: 'architecture',
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
