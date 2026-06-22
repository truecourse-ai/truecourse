import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** True for `Debug.Assert` / `Trace.Assert` (optionally fully qualified). */
function isAssertCall(fn: SyntaxNode): boolean {
  if (fn.type !== 'member_access_expression') return false
  if (fn.childForFieldName('name')?.text !== 'Assert') return false
  const target = fn.childForFieldName('expression')
  const targetName = target?.type === 'member_access_expression'
    ? target.childForFieldName('name')?.text
    : target?.text
  return targetName === 'Debug' || targetName === 'Trace'
}

/**
 * `Debug.Assert(condition)` with no message argument. When the assertion fails,
 * the dialog/log shows only a stack trace with no indication of which invariant
 * was violated. The single-argument overload should be replaced by one that
 * also supplies a descriptive message.
 */
export const csharpAssertWithoutMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-without-message',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || !isAssertCall(fn)) return null

    const args = node.childForFieldName('arguments')?.namedChildren.filter((c) => c?.type === 'argument') ?? []
    if (args.length !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Debug.Assert without a message',
      'This assertion supplies only a condition, so a failure gives no context about which invariant was violated.',
      sourceCode,
      'Use the overload that also takes a descriptive message string.',
    )
  },
}
