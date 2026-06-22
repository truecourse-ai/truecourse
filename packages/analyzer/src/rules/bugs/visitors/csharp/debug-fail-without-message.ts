import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** True for `Debug.Fail` / `Trace.Fail` (optionally fully qualified). */
function isFailCall(fn: SyntaxNode): boolean {
  if (fn.type !== 'member_access_expression') return false
  if (fn.childForFieldName('name')?.text !== 'Fail') return false
  const target = fn.childForFieldName('expression')
  const targetName = target?.type === 'member_access_expression'
    ? target.childForFieldName('name')?.text
    : target?.text
  return targetName === 'Debug' || targetName === 'Trace'
}

/**
 * `Debug.Fail()` with no message argument. Every Fail overload takes at least a
 * message; the parameterless form (or a stray empty argument list) leaves no
 * explanation for the forced failure, defeating the purpose of the call.
 */
export const csharpDebugFailWithoutMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/debug-fail-without-message',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || !isFailCall(fn)) return null

    const args = node.childForFieldName('arguments')?.namedChildren.filter((c) => c?.type === 'argument') ?? []
    if (args.length !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Debug.Fail without a message',
      'This Debug.Fail call passes no message, so the forced failure gives no indication of what went wrong.',
      sourceCode,
      'Pass a descriptive message describing why this branch should never be reached.',
    )
  },
}
