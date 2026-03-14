import type { AnalysisRule } from '@truecourse/shared'

export const DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'arch/layer-violation-data-api',
    category: 'architecture',
    name: 'Data layer depends on API layer',
    description: 'Data layer should not import from the API layer.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'arch/layer-violation-external-api',
    category: 'architecture',
    name: 'External layer depends on API layer',
    description: 'External integrations should not depend on the API layer directly.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'arch/layer-violation-data-external',
    category: 'architecture',
    name: 'Data layer depends on external layer',
    description: 'Data layer should not call external services.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
]
