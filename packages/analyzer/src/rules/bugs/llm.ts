import type { AnalysisRule } from '@truecourse/shared'

export const BUGS_LLM_RULES: AnalysisRule[] = [
  {
    key: 'bugs/llm/error-handling',
    category: 'code',
    domain: 'bugs',
    name: 'Incorrect error handling',
    description: 'Catch blocks that handle errors incorrectly — catching too broadly, rethrowing without context, logging but continuing as if nothing happened, returning misleading success values.',
    prompt:
      'Find catch blocks that handle errors incorrectly. Look for: catching too broadly (catch(e) with no type discrimination), rethrowing without adding context, logging the error but continuing execution as if nothing happened, or returning misleading success values after an error. Each instance should reference the specific file and line range.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'bugs/llm/race-condition',
    category: 'code',
    domain: 'bugs',
    name: 'Potential race condition',
    description: 'Shared mutable state across async boundaries, check-then-act on shared resources, multiple awaits modifying the same variable.',
    prompt:
      'Find potential race conditions in async code. Look for: shared mutable state (module-level variables, class properties) read and written across async boundaries, check-then-act patterns on shared resources (checking a condition then acting on it with an await in between), and multiple await expressions that modify the same variable or state without synchronization.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'bugs/llm/resource-leak',
    category: 'code',
    domain: 'bugs',
    name: 'Potential resource leak',
    description: 'File handles/connections/streams opened but not closed, missing cleanup in finally/unmount, event listeners without removal.',
    prompt:
      'Find potential resource leaks. Look for: file handles, database connections, or streams opened but not closed or not closed in a finally block, missing cleanup in React useEffect (addEventListener without removeEventListener, setInterval without clearInterval), and resources acquired in try blocks without corresponding cleanup in finally.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'bugs/llm/inconsistent-return',
    category: 'code',
    domain: 'bugs',
    name: 'Inconsistent return types',
    description: 'Functions returning inconsistent types across branches — sometimes value/sometimes undefined, mixing null/undefined.',
    prompt:
      'Find functions that return inconsistent types across different branches. Look for: functions that sometimes return a value and sometimes return nothing (implicit undefined), functions that mix null and undefined returns, and functions where some branches return a wrapped type (e.g., Promise, array) and others return the raw value.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
]
