import type { AnalysisRule } from '@truecourse/shared'

export const RELIABILITY_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'reliability/deterministic/catch-rethrow-no-context',
    category: 'code',
    domain: 'reliability',
    name: 'Catch and rethrow without context',
    description: 'Catch block rethrows the error without adding context or wrapping.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'reliability/deterministic/catch-without-error-type',
    category: 'code',
    domain: 'reliability',
    name: 'Catch without error type discrimination',
    description: 'Catch block does not check or narrow the error type before handling.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'reliability/deterministic/async-with-for-resources',
    category: 'code',
    domain: 'reliability',
    name: 'Async context manager for resources',
    description: 'Resource should use async with for proper cleanup in async code.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
]
