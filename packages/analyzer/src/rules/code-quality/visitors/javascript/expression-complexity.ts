import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

const BINARY_TYPES = new Set(['binary_expression', 'logical_expression'])

// Stop recursion at nested function bodies — each nested function's expressions
// are visited as their own statements; counting them again at the outer scope
// double-counts and inflates IIFE wrappers past the threshold for reasons
// unrelated to the IIFE call itself.
const FUNCTION_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',
])

// JSX subtrees compose React rendering — `||`/`&&` inside JSX expressions
// are independent conditionals, not part of one algorithmic expression.
const JSX_TYPES = new Set([
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_fragment',
  'jsx_expression',
  'jsx_attribute',
])

// Object/array/template literals collect independent property/element/segment
// expressions — each value is its own evaluation context, so operators across
// values are not part of a single "complex expression".
const VALUE_CONTAINER_TYPES = new Set([
  'object',
  'object_pattern',
  'array',
  'array_pattern',
  'template_string',
])

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

    // If the expression is itself a function literal, its body is analyzed via
    // its own nested return/expression statements — skip to avoid double-counting.
    if (FUNCTION_TYPES.has(expr.type)) return null

    // If the expression is JSX or a value-container literal, the operators
    // inside are part of independent sub-expressions, not one complex chain.
    if (JSX_TYPES.has(expr.type) || VALUE_CONTAINER_TYPES.has(expr.type)) return null

    // `.ts` files that contain JSX content get misparsed by the TypeScript
    // tree-sitter grammar (which doesn't understand JSX) as chains of binary
    // and assignment expressions over identifiers and strings. Detect this by
    // looking for JSX closing-tag syntax in the node text — `</identifier`
    // appears only in JSX, never in plain TS expressions.
    if (/<\/[A-Za-z]/.test(expr.text)) return null

    let operatorCount = 0

    function getOperatorText(n: SyntaxNode): string | null {
      const op = n.childForFieldName('operator')
      return op ? op.text : null
    }

    // Count operators but collapse runs of the same operator (e.g. a long
    // `a === 1 || a === 2 || a === 3 || ...` OR-chain, or a flat `+`/`*`
    // chain) into a single count. The TP marker (`a + b*c - d/e + f*g - a + b`)
    // mixes +, -, *, / with alternating operators, so collapsing same-operator
    // runs preserves it as complex while letting idiomatic OR/AND guards and
    // multi-field comparison chains pass.
    function countOps(n: SyntaxNode, parentOp: string | null) {
      const isBinary = BINARY_TYPES.has(n.type)
      let myOp: string | null = null
      if (isBinary) {
        myOp = getOperatorText(n)
        if (myOp !== parentOp) operatorCount++
      }

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (!child) continue
        if (FUNCTION_TYPES.has(child.type)) continue
        if (JSX_TYPES.has(child.type)) continue
        if (VALUE_CONTAINER_TYPES.has(child.type)) continue
        // When recursing within a same-operator chain, propagate the operator
        // so the chain collapses; otherwise reset.
        const nextParent = isBinary ? myOp : null
        countOps(child, nextParent)
      }
    }

    countOps(expr, null)

    if (operatorCount > 7) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Complex expression',
        `Expression has ${operatorCount} binary/logical operators (max 7). Break it into named variables for readability.`,
        sourceCode,
        'Split the expression into smaller, named intermediate variables.',
      )
    }
    return null
  },
}
