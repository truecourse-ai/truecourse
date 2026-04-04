import type { AnalysisRule } from '@truecourse/shared'

export const BUGS_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'bugs/deterministic/empty-catch',
    category: 'code',
    domain: 'bugs',
    name: 'Empty error handler',
    description: 'Empty catch/except blocks that swallow errors silently.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'bugs/deterministic/bare-except',
    category: 'code',
    domain: 'bugs',
    name: 'Bare except clause',
    description: 'Bare except catches all exceptions including KeyboardInterrupt and SystemExit.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'bugs/deterministic/mutable-default-arg',
    category: 'code',
    domain: 'bugs',
    name: 'Mutable default argument',
    description: 'Using mutable default arguments (list, dict, set) shares the object across calls.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
]
