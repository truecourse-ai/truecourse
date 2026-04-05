import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isBooleanGuarded(node: SyntaxNode): boolean {
  // !!expr is explicitly boolean
  if (node.type === 'unary_expression') {
    const op = node.children.find((c) => !c.isNamed)
    if (op?.text === '!') {
      const inner = node.namedChildren[0]
      if (inner?.type === 'unary_expression') {
        const innerOp = inner.children.find((c) => !c.isNamed)
        if (innerOp?.text === '!') return true
      }
    }
  }
  // Boolean(expr) is explicitly boolean
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.text === 'Boolean') return true
  }
  // Comparisons (>, <, ===, etc.) are always boolean
  if (node.type === 'binary_expression') {
    const op = node.children.find((c) => !c.isNamed)?.text
    if (op && ['>', '<', '>=', '<=', '===', '!==', '==', '!='].includes(op)) return true
  }
  // true/false literals
  if (node.type === 'true' || node.type === 'false') return true
  return false
}

export const reactLeakedRenderVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-leaked-render',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_expression'],
  visit(node, filePath, sourceCode) {
    // Detect: {count && <Component/>} where count could be 0
    // Look for binary_expression with && where left side is a potential non-boolean
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'binary_expression') return null

    const op = expr.children.find((c) => c.type === '&&')
    if (!op) return null

    const left = expr.childForFieldName('left')
    if (!left) return null

    // If left side is not explicitly boolean-guarded, flag it
    if (!isBooleanGuarded(left)) {
      return makeViolation(
        this.ruleKey, expr, filePath, 'medium',
        'React leaked render: non-boolean condition',
        `\`${left.text}\` in JSX condition may render unexpected values (like \`0\` or \`""\`) when falsy.`,
        sourceCode,
        `Convert to boolean: \`{!!${left.text} && ...}\` or \`{${left.text} > 0 && ...}\`.`,
      )
    }

    return null
  },
}
