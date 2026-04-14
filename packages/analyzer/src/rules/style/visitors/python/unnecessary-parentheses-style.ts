import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryParenthesesStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/unnecessary-parentheses-style',
  languages: ['python'],
  nodeTypes: ['return_statement', 'assert_statement'],
  visit(node, filePath, sourceCode) {
    // Detect unnecessary parentheses around return values or assert conditions.
    // E.g.: `return (value)` instead of `return value`
    //        `assert (condition)` instead of `assert condition`

    let expr = null
    if (node.type === 'return_statement') {
      // return_statement children: 'return' keyword + optional expression
      expr = node.namedChildren[0]
    } else if (node.type === 'assert_statement') {
      // assert_statement children: 'assert' keyword + condition + optional message
      expr = node.namedChildren[0]
    }

    if (!expr || expr.type !== 'parenthesized_expression') return null

    // A parenthesized_expression wrapping a single value is unnecessary.
    // Exception: tuples like `return (a, b)` which are tuple nodes, not
    // parenthesized_expression. Also exclude generator expressions.
    const inner = expr.namedChildren[0]
    if (!inner) return null

    // Allow multi-line expressions inside parens (they might need parens for readability)
    if (expr.startPosition.row !== expr.endPosition.row) return null

    // Allow if the inner expression is complex (conditional, binary op spanning
    // multiple terms), but flag simple identifiers, literals, and calls
    const SIMPLE_TYPES = new Set([
      'identifier', 'integer', 'float', 'string', 'true', 'false', 'none',
      'call', 'attribute', 'subscript',
    ])
    if (!SIMPLE_TYPES.has(inner.type)) return null

    const keyword = node.type === 'return_statement' ? 'return' : 'assert'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Unnecessary parentheses in ${keyword} statement`,
      `The parentheses around the ${keyword} value are not needed. Write \`${keyword} ${inner.text}\` instead of \`${keyword} (${inner.text})\`.`,
      sourceCode,
      `Remove the unnecessary parentheses: \`${keyword} ${inner.text}\`.`,
    )
  },
}
