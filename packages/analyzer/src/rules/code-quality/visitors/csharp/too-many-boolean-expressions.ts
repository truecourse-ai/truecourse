import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const MAX_BOOLEAN_CLAUSES = 3

function isBooleanOperator(node: SyntaxNode): boolean {
  if (node.type !== 'binary_expression') return false
  const op = node.childForFieldName('operator')?.text
  return op === '&&' || op === '||'
}

function unwrapParens(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.type === 'parenthesized_expression' && current.namedChildren[0]) {
    current = current.namedChildren[0]!
  }
  return current
}

function countBooleanClauses(node: SyntaxNode): number {
  const n = unwrapParens(node)
  if (!isBooleanOperator(n)) return 1
  const left = n.childForFieldName('left')
  const right = n.childForFieldName('right')
  return (left ? countBooleanClauses(left) : 0) + (right ? countBooleanClauses(right) : 0)
}

export const csharpTooManyBooleanExpressionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-boolean-expressions',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (!isBooleanOperator(node)) return null
    // Only measure at the top of an &&/|| chain (allow a parenthesized
    // sub-chain to be part of its parent's count, not its own finding).
    let ancestor = node.parent
    while (ancestor?.type === 'parenthesized_expression') ancestor = ancestor.parent
    if (ancestor && isBooleanOperator(ancestor)) return null

    const count = countBooleanClauses(node)
    if (count > MAX_BOOLEAN_CLAUSES) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many boolean expressions',
        `This boolean expression has ${count} clauses (threshold: ${MAX_BOOLEAN_CLAUSES}). Complex conditions are hard to understand and test.`,
        sourceCode,
        'Extract complex boolean conditions into named variables or helper methods with descriptive names.',
      )
    }
    return null
  },
}
