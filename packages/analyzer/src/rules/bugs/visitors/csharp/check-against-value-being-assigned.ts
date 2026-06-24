import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The single statement of an if-consequence, unwrapping a one-statement block. */
function singleStatement(consequence: SyntaxNode): SyntaxNode | null {
  if (consequence.type === 'block') {
    const stmts = consequence.namedChildren.filter((c) => c?.type !== 'comment')
    return stmts.length === 1 ? stmts[0]! : null
  }
  return consequence
}

/**
 * `if (x != v) x = v;` — guarding a plain assignment with an inequality check
 * against the very value being assigned is redundant: assigning `v` to `x` when
 * they already differ has the identical effect as assigning unconditionally.
 * The guard adds noise and often hides a copy-paste mistake (the author meant a
 * different right-hand side or a different comparison).
 *
 * Only fires when the guarded statement is exactly the assignment `x = v` whose
 * operands mirror the `x != v` condition, with no else branch and no other body.
 */
export const csharpCheckAgainstValueBeingAssignedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/check-against-value-being-assigned',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    const condition = node.childForFieldName('condition')
    if (condition?.type !== 'binary_expression') return null
    if (condition.childForFieldName('operator')?.text !== '!=') return null
    const condLeft = condition.childForFieldName('left')
    const condRight = condition.childForFieldName('right')
    if (!condLeft || !condRight) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const stmt = singleStatement(consequence)
    if (stmt?.type !== 'expression_statement') return null
    const assign = stmt.namedChildren[0]
    if (assign?.type !== 'assignment_expression') return null
    if (assign.childForFieldName('operator')?.text !== '=') return null

    const target = assign.childForFieldName('left')
    const value = assign.childForFieldName('right')
    if (!target || !value) return null

    // The condition must be exactly `target != value` (in either order).
    const sameAB = condLeft.text === target.text && condRight.text === value.text
    const sameBA = condLeft.text === value.text && condRight.text === target.text
    if (!sameAB && !sameBA) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant check against the value being assigned',
      `\`if (${condition.text}) ${assign.text};\` guards a plain assignment with a check against the same value — assigning unconditionally has the identical effect.`,
      sourceCode,
      'Remove the guard and assign unconditionally, or fix the condition if a different check was intended.',
    )
  },
}
