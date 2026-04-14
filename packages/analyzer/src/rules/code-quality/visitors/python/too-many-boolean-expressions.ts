import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const MAX_BOOLEAN_CLAUSES = 3

function countBooleanClauses(node: SyntaxNode): number {
  if (node.type !== 'boolean_operator') return 1
  const left = node.namedChildren[0]
  const right = node.namedChildren[1]
  return (left ? countBooleanClauses(left) : 0) + (right ? countBooleanClauses(right) : 0)
}

export const pythonTooManyBooleanExpressionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-boolean-expressions',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    // Only check top-level boolean_operator
    if (node.parent?.type === 'boolean_operator') return null

    const count = countBooleanClauses(node)
    if (count > MAX_BOOLEAN_CLAUSES) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many boolean expressions',
        `This boolean expression has ${count} clauses (threshold: ${MAX_BOOLEAN_CLAUSES}). Complex conditions are hard to understand and test.`,
        sourceCode,
        'Extract complex boolean conditions into named variables or helper functions with descriptive names.',
      )
    }

    return null
  },
}
