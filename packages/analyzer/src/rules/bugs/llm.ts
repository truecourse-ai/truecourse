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
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasCatchBlocks: true },
      functionFilter: { containsCatchBlock: true },
    },
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
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasAsyncFunctions: true },
      functionFilter: { isAsync: true },
    },
  },
]
