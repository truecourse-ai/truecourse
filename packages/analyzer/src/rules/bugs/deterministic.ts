import type { AnalysisRule } from '@truecourse/shared'

export const BUGS_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'bugs/deterministic/invalid-pyproject-toml',
    category: 'code',
    name: 'Invalid pyproject.toml',
    description: 'pyproject.toml has syntax errors or missing required fields (PEP 621).',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'bugs/deterministic/all-branches-identical',
    category: 'code',
    domain: 'bugs',
    name: 'All branches identical',
    description: 'If/else or switch where all branches execute the same code — condition is pointless.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
]
