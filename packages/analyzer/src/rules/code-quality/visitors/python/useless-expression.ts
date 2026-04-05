import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Expression types that are purely useless when used as statements
const USELESS_EXPR_TYPES = new Set([
  'comparison_operator',
  'boolean_operator',
  'not_operator',
  'binary_operator',
  'unary_operator',
])

export const pythonUselessExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-expression',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Allow strings (docstrings) at module/class/function level
    if (expr.type === 'string' || expr.type === 'concatenated_string') return null
    // Allow calls (may have side effects)
    if (expr.type === 'call') return null
    // Allow await expressions
    if (expr.type === 'await') return null
    // Allow yield expressions
    if (expr.type === 'yield') return null
    // Allow assignments (augmented, etc.)
    if (expr.type === 'assignment') return null

    if (USELESS_EXPR_TYPES.has(expr.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless expression statement',
        `Expression \`${expr.text.slice(0, 40)}\` is computed but its result is never used.`,
        sourceCode,
        'Remove the expression or assign its result to a variable.',
      )
    }
    return null
  },
}
