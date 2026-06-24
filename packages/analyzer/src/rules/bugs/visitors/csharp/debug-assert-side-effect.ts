import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A `Debug.Assert`/`Trace.Assert` whose condition mutates state via an assignment
 * or an increment/decrement. The `[Conditional("DEBUG")]` call — and therefore the
 * whole argument expression — is compiled out of release builds, so the mutation
 * silently stops happening and behaviour diverges between Debug and Release. Only
 * assignments and `++`/`--` are flagged (unambiguous side effects); method calls
 * are left alone to avoid false positives on the many pure calls in assert
 * conditions.
 */
export const csharpDebugAssertSideEffectVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/debug-assert-side-effect',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_access_expression') return null
    if (fn.childForFieldName('name')?.text !== 'Assert') return null
    const recv = fn.childForFieldName('expression')?.text
    if (recv !== 'Debug' && recv !== 'Trace') return null

    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChildren.find((c) => c?.type === 'argument')
    const condition = firstArg?.namedChild(0)
    if (!condition || !hasMutation(condition)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Side effect in a Debug.Assert condition',
      `${recv}.Assert condition mutates state — it is compiled out of Release builds, so the side effect disappears.`,
      sourceCode,
      'Compute the value before the assert and assert against the result.',
    )
  },
}

function hasMutation(node: SyntaxNode): boolean {
  if (node.type === 'assignment_expression') return true
  if (node.type === 'prefix_unary_expression' || node.type === 'postfix_unary_expression') {
    if (node.text.includes('++') || node.text.includes('--')) return true
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && hasMutation(child)) return true
  }
  return false
}
