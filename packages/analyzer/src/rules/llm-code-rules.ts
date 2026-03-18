import type { AnalysisRule } from '@truecourse/shared'

export const LLM_CODE_RULES: AnalysisRule[] = [
  {
    key: 'llm/code-error-handling',
    category: 'code',
    name: 'Incorrect error handling',
    description: 'Catch blocks that handle errors incorrectly — catching too broadly, rethrowing without context, logging but continuing as if nothing happened, returning misleading success values.',
    prompt:
      'Find catch blocks that handle errors incorrectly. Look for: catching too broadly (catch(e) with no type discrimination), rethrowing without adding context, logging the error but continuing execution as if nothing happened, or returning misleading success values after an error. Each instance should reference the specific file and line range.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'llm/code-race-condition',
    category: 'code',
    name: 'Potential race condition',
    description: 'Shared mutable state across async boundaries, check-then-act on shared resources, multiple awaits modifying the same variable.',
    prompt:
      'Find potential race conditions in async code. Look for: shared mutable state (module-level variables, class properties) read and written across async boundaries, check-then-act patterns on shared resources (checking a condition then acting on it with an await in between), and multiple await expressions that modify the same variable or state without synchronization.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'llm/code-misleading-name',
    category: 'code',
    name: 'Misleading function or variable name',
    description: 'Functions/variables whose names do not match their behavior — validate that mutates, getUser that deletes, isValid with side effects.',
    prompt:
      'Find functions or variables whose names are misleading about what they actually do. Look for: functions named "get*" or "find*" that mutate state or have side effects, functions named "validate*" or "check*" that also modify data, boolean-named variables/functions ("is*", "has*", "should*") that perform side effects, and names that suggest a narrower scope than the function actually has.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/code-dead-code',
    category: 'code',
    name: 'Dead or unreachable code',
    description: 'Unreachable code after return/throw, always-true/false conditions, assigned-but-never-read variables.',
    prompt:
      'Find dead or unreachable code. Look for: code after unconditional return/throw/break/continue statements, conditions that are always true or always false based on the surrounding logic, variables that are assigned but never read afterward, and functions that are defined but never called within the module.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/code-security-misuse',
    category: 'code',
    name: 'Security anti-pattern',
    description: 'Math.random() for tokens, disabled TLS, eval() with dynamic input, innerHTML with unsanitized input, wildcard CORS with credentials.',
    prompt:
      'Find security anti-patterns. Look for: Math.random() used for tokens, secrets, or IDs (should use crypto.randomUUID or crypto.getRandomValues), disabled TLS verification (rejectUnauthorized: false), eval() or Function() with dynamic/user input, innerHTML or dangerouslySetInnerHTML with unsanitized input, and wildcard CORS origins ("*") combined with credentials.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
  {
    key: 'llm/code-resource-leak',
    category: 'code',
    name: 'Potential resource leak',
    description: 'File handles/connections/streams opened but not closed, missing cleanup in finally/unmount, event listeners without removal.',
    prompt:
      'Find potential resource leaks. Look for: file handles, database connections, or streams opened but not closed or not closed in a finally block, missing cleanup in React useEffect (addEventListener without removeEventListener, setInterval without clearInterval), and resources acquired in try blocks without corresponding cleanup in finally.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
  },
  {
    key: 'llm/code-inconsistent-return',
    category: 'code',
    name: 'Inconsistent return types',
    description: 'Functions returning inconsistent types across branches — sometimes value/sometimes undefined, mixing null/undefined.',
    prompt:
      'Find functions that return inconsistent types across different branches. Look for: functions that sometimes return a value and sometimes return nothing (implicit undefined), functions that mix null and undefined returns, and functions where some branches return a wrapped type (e.g., Promise, array) and others return the raw value.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
]
