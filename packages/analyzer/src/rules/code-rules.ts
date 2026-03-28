import type { AnalysisRule } from '@truecourse/shared'

export const CODE_RULES: AnalysisRule[] = [
  // Multi-language rules (JS/TS + Python)
  {
    key: 'code/empty-catch',
    category: 'code',
    name: 'Empty error handler',
    description: 'Empty catch/except blocks that swallow errors silently.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'code/console-log',
    category: 'code',
    name: 'Debug logging in production',
    description: 'Debug logging calls (console.log, print) in production code.',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
  {
    key: 'code/no-explicit-any',
    category: 'code',
    name: 'Untyped escape hatch',
    description: 'Using any/Any types bypasses type checking safety.',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
  {
    key: 'code/sql-injection',
    category: 'code',
    name: 'Potential SQL injection',
    description: 'String interpolation or concatenation in database query calls.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  // Language-agnostic rules
  {
    key: 'code/hardcoded-secret',
    category: 'code',
    name: 'Hardcoded secret',
    description: 'String literals matching API key, token, or password patterns.',
    enabled: true,
    severity: 'critical',
    type: 'deterministic',
  },
  {
    key: 'code/todo-fixme',
    category: 'code',
    name: 'TODO/FIXME comment',
    description: 'TODO, FIXME, or HACK comments left in the codebase.',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
  // Multi-language rules (JS/TS + Python)
  {
    key: 'code/star-import',
    category: 'code',
    name: 'Wildcard import',
    description: 'Wildcard imports (import *, from x import *) pollute namespace and hide dependencies.',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
  // Python-specific rules
  {
    key: 'code/bare-except',
    category: 'code',
    name: 'Bare except clause',
    description: 'Bare except catches all exceptions including KeyboardInterrupt and SystemExit.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'code/mutable-default-arg',
    category: 'code',
    name: 'Mutable default argument',
    description: 'Using mutable default arguments (list, dict, set) shares the object across calls.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  // Multi-language rules (JS/TS + Python)
  {
    key: 'code/global-statement',
    category: 'code',
    name: 'Global state mutation',
    description: 'Modifying global/module-level state from inside functions (Python: global, JS: var).',
    enabled: true,
    severity: 'medium',
    type: 'deterministic',
  },
]
