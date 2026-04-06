import type { AnalysisRule } from '@truecourse/shared'

export const DATABASE_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'database/deterministic/connection-not-released',
    category: 'code',
    domain: 'database',
    name: 'Database connection not released',
    description: 'Connection acquired from pool but not released in a finally/using block — can exhaust connection pool.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'database/deterministic/missing-transaction',
    category: 'code',
    domain: 'database',
    name: 'Multiple writes without transaction',
    description: 'Multiple related INSERT/UPDATE/DELETE calls that should be atomic but are not wrapped in a transaction.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
]
