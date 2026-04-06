import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects walrus operator (:=) used in a context where the assigned value is not used.
 * e.g., `(x := compute())` as an expression statement — the assignment is a side effect only.
 */
export const pythonNamedExprWithoutContextVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/named-expr-without-context',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    // The entire statement is just a named expression: (x := value)
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Could be directly a named_expression or wrapped in parenthesized_expression
    let namedExpr = expr
    if (expr.type === 'parenthesized_expression') {
      const inner = expr.namedChildren[0]
      if (inner) namedExpr = inner
    }

    if (namedExpr.type !== 'named_expression') return null

    const nameNode = namedExpr.childForFieldName('name')
    return makeViolation(
      this.ruleKey, namedExpr, filePath, 'medium',
      'Walrus operator used without context',
      `\`${namedExpr.text}\` uses the walrus operator (:=) as a standalone expression — the assigned value \`${nameNode?.text ?? ''}\` is not used in a condition or comprehension. This is a confusing side effect; use a regular assignment instead.`,
      sourceCode,
      `Replace \`(${namedExpr.text})\` with a regular assignment: \`${nameNode?.text ?? 'x'} = ${namedExpr.namedChildren[1]?.text ?? 'value'}\`.`,
    )
  },
}
