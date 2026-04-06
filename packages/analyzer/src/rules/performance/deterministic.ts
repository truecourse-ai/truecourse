import type { AnalysisRule } from '@truecourse/shared'

export const PERFORMANCE_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'performance/deterministic/event-listener-no-remove',
    category: 'code',
    domain: 'performance',
    name: 'Event listener without cleanup',
    description: 'addEventListener without matching removeEventListener — causes memory leaks.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'performance/deterministic/inline-function-in-jsx-prop',
    category: 'code',
    domain: 'performance',
    name: 'Inline function in JSX prop',
    description: 'Arrow function or .bind() in JSX props causes new reference every render, defeating React.memo.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'performance/deterministic/batch-writes-in-loop',
    category: 'code',
    domain: 'performance',
    name: 'Batch writes in loop',
    description: 'Individual write operations inside a loop — should batch for performance.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
]
