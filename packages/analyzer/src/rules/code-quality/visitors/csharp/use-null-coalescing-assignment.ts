import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An `if (x == null) x = y;` block restates the null-coalescing assignment
 * operator `??=`, which is a single, atomic-reading expression. The check
 * matches an `if` with no `else`, a condition of the form `<lvalue> == null`,
 * and a body that is exactly one plain assignment to that same lvalue.
 */

function singleStatement(body: SyntaxNode): SyntaxNode | null {
  if (body.type === 'expression_statement') return body
  if (body.type === 'block') {
    const stmts = body.namedChildren.filter((c) => c != null && c.type !== 'comment')
    return stmts.length === 1 ? stmts[0]! : null
  }
  return null
}

export const csharpUseNullCoalescingAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-null-coalescing-assignment',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    const cond = node.childForFieldName('condition')
    if (cond?.type !== 'binary_expression') return null
    if (cond.childForFieldName('operator')?.text !== '==') return null
    const left = cond.childForFieldName('left')
    const right = cond.childForFieldName('right')
    if (!left || right?.type !== 'null_literal') return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const stmt = singleStatement(consequence)
    if (stmt?.type !== 'expression_statement') return null

    const assign = stmt.namedChildren[0]
    if (assign?.type !== 'assignment_expression') return null
    if (assign.childForFieldName('operator')?.text !== '=') return null
    if (assign.childForFieldName('left')?.text !== left.text) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use ??= for null-coalescing assignment',
      `\`if (${left.text} == null) ${left.text} = …\` restates the \`??=\` operator, which reads atomically.`,
      sourceCode,
      `Replace the null-check assignment with \`${left.text} ??= …\`.`,
    )
  },
}
