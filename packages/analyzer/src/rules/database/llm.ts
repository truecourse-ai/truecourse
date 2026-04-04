import type { AnalysisRule } from '@truecourse/shared'

export const DATABASE_LLM_RULES: AnalysisRule[] = [
  {
    key: 'database/llm/missing-foreign-key',
    category: 'database',
    domain: 'database',
    name: 'Missing foreign key constraint',
    description: 'Columns ending in _id without FK constraint.',
    prompt:
      'Look for columns ending in `_id` or `Id` that do not have a corresponding foreign key constraint defined. Missing foreign keys allow orphaned records and break referential integrity. Flag each instance with the table and column name.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'database/llm/missing-index',
    category: 'database',
    domain: 'database',
    name: 'Missing index on foreign key column',
    description: 'FK columns without index cause slow queries.',
    prompt:
      'Check whether foreign key columns have an index defined. Foreign key columns without indexes cause slow JOIN queries and lookups. Flag any FK column that appears to lack an index.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'database/llm/naming-inconsistency',
    category: 'database',
    domain: 'database',
    name: 'Inconsistent naming conventions',
    description: 'Mixed naming conventions across tables and columns.',
    prompt:
      'Check for mixed naming conventions across tables and columns. Common inconsistencies include mixing snake_case and camelCase, mixing singular and plural table names, or using inconsistent prefixes. Flag specific examples of inconsistency.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
  {
    key: 'database/llm/missing-timestamps',
    category: 'database',
    domain: 'database',
    name: 'Missing created_at / updated_at columns',
    description: 'Tables missing standard timestamp columns for audit trails.',
    prompt:
      'Check whether tables have `created_at` and `updated_at` (or equivalent) timestamp columns. These are standard for audit trails and debugging. Flag tables that are missing one or both timestamp columns.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
  {
    key: 'database/llm/overly-nullable',
    category: 'database',
    domain: 'database',
    name: 'Too many nullable columns',
    description: 'Tables where a large proportion of columns are nullable.',
    prompt:
      'Identify tables where a large proportion of columns are nullable. Excessive nullability often indicates a poorly normalized schema or optional fields that should be in a separate table. Flag tables where more than half of non-PK columns are nullable.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
]
