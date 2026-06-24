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

    // Unwrap parentheses and type-cast wrappers for the shape checks below.
    let target = expr
    while (
      (target.type === 'parenthesized_expression'
        || target.type === 'as_expression'
        || target.type === 'satisfies_expression'
        || target.type === 'non_null_expression')
      && target.namedChildren[0]
    ) {
      target = target.namedChildren[0]
    }

    // Skip object / array literals. These are collections of independent
    // members, not a single tangled expression — their keys/positions already
    // name the parts, so "break it into named variables" does not apply.
    // Summing operators across every property value or array element (e.g. a
    // table of `{ value: 5 * 60 * 1000 }` rows, or `{ a: x - y, b: z - w }`
    // perf maps) inflates the score for reasons unrelated to any one member.
    if (target.type === 'object' || target.type === 'array') return null

    // Skip declarators / returns whose value is itself a function. The
    // function body is visited as its own statements, so counting
    // operators in the body at the outer declarator double-counts and
    // inflates the score past the threshold for reasons unrelated to
    // the declarator itself (e.g. `export const handler = (...) => {…}`).
    if (target.type === 'arrow_function'
      || target.type === 'function_expression'
      || target.type === 'function_declaration'
      || target.type === 'generator_function'
      || target.type === 'generator_function_declaration') return null

    // Skip JSX render returns. JSX naturally uses `&&` for conditional
    // composition; counting those as boolean-expression operators reads
    // declarative markup as tangled logic.
    if (target.type === 'jsx_element'
      || target.type === 'jsx_fragment'
      || target.type === 'jsx_self_closing_element') return null

    let operatorCount = 0
    // Track which kinds of operator appear, to tell a flat boolean predicate
    // list (`x === "a" || x === "b" || …`, `x.startsWith(p) || …`) apart from
    // genuinely tangled arithmetic/mixed logic. The former reads like a set
    // membership test — extracting intermediates does not improve it — so it
    // is exempt; the latter (which mixes in `+`, `*`, etc.) is still flagged.
    let hasLogical = false
    let hasArithmetic = false
    const LOGICAL_OPS = new Set(['&&', '||', '??'])
    const ARITHMETIC_OPS = new Set(['+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>'])
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
        const op = n.childForFieldName('operator')?.text
        if (op) {
          if (LOGICAL_OPS.has(op)) hasLogical = true
          else if (ARITHMETIC_OPS.has(op)) hasArithmetic = true
        }
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
      // Flat boolean predicate list (logical operators + comparisons only, no
      // arithmetic): a readable membership/guard test, not tangled logic.
      if (hasLogical && !hasArithmetic) return null
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
