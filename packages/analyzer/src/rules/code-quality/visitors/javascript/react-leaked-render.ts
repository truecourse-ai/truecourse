import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

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

// Common boolean-named identifiers that are always safe
const BOOLEAN_NAMES = /^(is[A-Z]|has[A-Z]|show[A-Z]|can[A-Z]|should[A-Z]|loading|disabled|open|visible|checked|selected|expanded|active|enabled|hidden|readonly|required)/

export const reactLeakedRenderVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-leaked-render',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    // Detect: {count && <Component/>} where count could be 0
    // Look for binary_expression with && where left side is a potential non-boolean
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'binary_expression') return null

    const op = expr.children.find((c) => c.type === '&&')
    if (!op) return null

    const left = expr.childForFieldName('left')
    if (!left) return null

    // If left side is explicitly boolean-guarded, skip
    if (isBooleanGuarded(left)) return null

    // Skip common boolean-named identifiers
    if (left.type === 'identifier' && BOOLEAN_NAMES.test(left.text)) return null
    // Skip member access on common boolean names (e.g., props.isOpen)
    if (left.type === 'member_expression') {
      const prop = left.childForFieldName('property')
      if (prop && BOOLEAN_NAMES.test(prop.text)) return null
    }

    // If type query is available, only flag when the type includes number
    // (the leaked render bug only happens with 0 rendering as "0")
    if (typeQuery) {
      const isNumber = typeQuery.isNumberType(
        filePath,
        left.startPosition.row,
        left.startPosition.column,
        left.endPosition.row,
        left.endPosition.column,
      )
      if (!isNumber) return null
    }

    return makeViolation(
      this.ruleKey, expr, filePath, 'medium',
      'React leaked render: non-boolean condition',
      `\`${left.text}\` in JSX condition may render unexpected values (like \`0\`) when falsy.`,
      sourceCode,
      `Convert to boolean: \`{!!${left.text} && ...}\` or \`{${left.text} > 0 && ...}\`.`,
    )
  },
}
