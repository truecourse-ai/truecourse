import type { AnalysisRule } from '@truecourse/shared'

export const CODE_QUALITY_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'code-quality/deterministic/console-log',
    category: 'code',
    domain: 'code-quality',
    name: 'Debug logging in production',
    description: 'Debug logging calls (console.log, print) in production code.',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
  {
    key: 'code-quality/deterministic/todo-fixme',
    category: 'code',
    domain: 'code-quality',
    name: 'TODO/FIXME comment',
    description: 'TODO, FIXME, or HACK comments left in the codebase.',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
  {
    key: 'code-quality/deterministic/accessor-pairs',
    category: 'code',
    domain: 'code-quality',
    name: 'Accessor pairs',
    description: 'Class has a setter without a matching getter, or vice versa.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'code-quality/deterministic/abstract-class-without-abstract-method',
    category: 'code',
    domain: 'code-quality',
    name: 'Abstract class without abstract method',
    description: 'Class uses ABC/ABCMeta but defines no abstract methods.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
]
