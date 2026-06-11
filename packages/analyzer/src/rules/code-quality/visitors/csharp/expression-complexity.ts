import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpFunctionBoundary } from './_helpers.js'

export const csharpExpressionComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/expression-complexity',
  languages: ['csharp'],
  nodeTypes: ['expression_statement', 'return_statement', 'variable_declarator'],
  visit(node, filePath, sourceCode) {
    let expr: SyntaxNode | null = null
    if (node.type === 'expression_statement' || node.type === 'return_statement') {
      expr = node.namedChildren[0] ?? null
    } else if (node.type === 'variable_declarator') {
      // The initializer is whatever named child follows the name.
      const name = node.childForFieldName('name')
      expr = node.namedChildren.find((c) => c && c.id !== name?.id) ?? null
    }
    if (!expr) return null

    let target = expr
    while (target.type === 'parenthesized_expression' && target.namedChildren[0]) {
      target = target.namedChildren[0]!
    }
    // A lambda value's body is measured as its own statements.
    if (target.type === 'lambda_expression' || target.type === 'anonymous_method_expression') return null
    // Switch expressions are declarative pattern matching, never "complex".
    if (target.type === 'switch_expression') return null

    let operatorCount = 0

    function countOps(n: SyntaxNode) {
      if (n.type === 'binary_expression') operatorCount++
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        // Lambda bodies (LINQ predicates) carry their own complexity budget.
        if (isCSharpFunctionBoundary(child.type)) continue
        if (child.type === 'switch_expression') continue
        countOps(child)
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
