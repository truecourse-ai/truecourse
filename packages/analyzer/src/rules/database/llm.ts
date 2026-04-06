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
]
