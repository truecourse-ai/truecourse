import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * C# analog of the `debugger` statement: programmatic debugger hooks left in
 * the code (`Debugger.Break()` / `Debugger.Launch()`).
 */
export function isCSharpDebuggerCall(invocation: SyntaxNode): boolean {
  const method = getCSharpMethodName(invocation)
  if (method !== 'Break' && method !== 'Launch') return false
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return false
  const receiver = fn.childForFieldName('expression')?.text ?? ''
  return receiver === 'Debugger' || receiver.endsWith('Diagnostics.Debugger')
}

export const csharpNoDebuggerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-debugger',
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
