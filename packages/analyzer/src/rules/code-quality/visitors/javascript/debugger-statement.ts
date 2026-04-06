import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsDebuggerStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/debugger-statement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['debugger_statement'],
  visit(node, filePath, sourceCode) {
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Debugger statement',
      '`debugger` statement must be removed before deploying to production.',
      sourceCode,
      'Remove the debugger statement.',
    )
  },
}
