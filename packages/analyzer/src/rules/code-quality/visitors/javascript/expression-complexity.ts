import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const expressionComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/expression-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement', 'return_statement', 'variable_declarator', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    let expr: SyntaxNode | null = null
    if (node.type === 'expression_statement' || node.type === 'return_statement') {
      expr = node.namedChildren[0] ?? null
    } else if (node.type === 'variable_declarator') {
      expr = node.childForFieldName('value')
    } else if (node.type === 'assignment_expression') {
      expr = node.childForFieldName('right')
    }
    if (!expr) return null

    let operatorCount = 0
    const BINARY_TYPES = new Set(['binary_expression', 'logical_expression'])

    function countOps(n: SyntaxNode) {
      if (BINARY_TYPES.has(n.type)) {
        operatorCount++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countOps(child)
      }
    }

    countOps(expr)

    if (operatorCount > 5) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Complex expression',
        `Expression has ${operatorCount} binary/logical operators (max 5). Break it into named variables for readability.`,
        sourceCode,
        'Split the expression into smaller, named intermediate variables.',
      )
    }
    return null
  },
}
