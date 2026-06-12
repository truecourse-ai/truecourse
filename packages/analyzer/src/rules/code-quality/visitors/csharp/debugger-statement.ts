import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpDebuggerCall } from './no-debugger.js'

export const csharpDebuggerStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/debugger-statement',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!isCSharpDebuggerCall(node)) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Debugger call',
      '`Debugger.Break()`/`Debugger.Launch()` must be removed before deploying to production.',
      sourceCode,
      'Remove the debugger call.',
    )
  },
}
