import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

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

    // Unwrap parenthesized_expression so `return (<X/>)` is recognized.
    while (expr && expr.type === 'parenthesized_expression') {
      expr = expr.namedChildren[0] ?? null
    }
    if (!expr) return null

    // Skip when `expr` itself is a function or JSX subtree. Their inner
    // statements / embedded expressions are visited as their own
    // expression_statement / return_statement / variable_declarator nodes,
    // and counted there. Counting them again at the outer site sums every
    // nested operator across the entire component into one finding —
    // which is the bug, not a feature.
    const SKIP_TOP_LEVEL_TYPES = new Set([
      'arrow_function',
      'function_expression',
      'function',
      'generator_function',
      'class_expression',
      'jsx_element',
      'jsx_self_closing_element',
      'jsx_fragment',
    ])
    if (SKIP_TOP_LEVEL_TYPES.has(expr.type)) return null

    let operatorCount = 0
    const BINARY_TYPES = new Set(['binary_expression', 'logical_expression'])
    // Don't recurse into nested function bodies. Each nested function's
    // expressions are visited as their own `expression_statement` /
    // `return_statement` nodes - counting them again at the outer scope
    // double-counts and inflates IIFE wrappers (which call a function whose
    // body has its own complex expressions) past the threshold for reasons
    // unrelated to the IIFE call itself.
    const FUNCTION_BOUNDARY_TYPES = new Set([
      'function_declaration',
      'function_expression',
      'arrow_function',
      'method_definition',
      'generator_function_declaration',
      'generator_function',
    ])

    function countOps(n: SyntaxNode) {
      if (BINARY_TYPES.has(n.type)) {
        operatorCount++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (!child) continue
        if (FUNCTION_BOUNDARY_TYPES.has(child.type)) continue
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
