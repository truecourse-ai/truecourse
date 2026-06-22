import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `xs.Any(x => x == value)` is a roundabout way to write `xs.Contains(value)`:
 * it allocates a delegate and runs a per-element predicate where `Contains`
 * uses the collection's own equality. Fires only when `Any` has a single lambda
 * whose body is `param == other` (or `other == param`) — a simple equality
 * against the lambda parameter, so predicates doing real work are left alone.
 */
function lambdaParamName(lambda: SyntaxNode): string | null {
  const params = lambda.namedChildren.filter(
    (c): c is SyntaxNode => !!c && (c.type === 'implicit_parameter' || c.type === 'parameter'),
  )
  // A simple `parameter_list` wrapper is also possible: `(x) => ...`.
  const list = lambda.namedChildren.find((c) => c?.type === 'parameter_list')
  if (list) {
    const inner = list.namedChildren.filter((c): c is SyntaxNode => !!c && c.type === 'parameter')
    if (inner.length === 1) return inner[0]!.childForFieldName('name')?.text ?? inner[0]!.text
    return null
  }
  if (params.length !== 1) return null
  const p = params[0]!
  return p.type === 'implicit_parameter' ? p.text : (p.childForFieldName('name')?.text ?? null)
}

export const csharpPreferContainsOverAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-contains-over-any',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Any') return null
    // Must be a member call so `xs` is a real receiver, not a bare Any().
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1 || args[0]!.type !== 'lambda_expression') return null
    const lambda = args[0]!
    const param = lambdaParamName(lambda)
    if (!param) return null

    const body = lambda.childForFieldName('body')
    if (!body || body.type !== 'binary_expression') return null
    if (body.childForFieldName('operator')?.text !== '==') return null
    const left = body.childForFieldName('left')
    const right = body.childForFieldName('right')
    if (!left || !right) return null

    // One side must be exactly the lambda parameter; the other must not also
    // reference it (so we don't rewrite `x => x == x.Other`).
    const leftIsParam = left.type === 'identifier' && left.text === param
    const rightIsParam = right.type === 'identifier' && right.text === param
    if (leftIsParam === rightIsParam) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Contains should be used instead of Any for equality checks',
      'Any(x => x == value) allocates a delegate and runs a predicate per element to do what Contains(value) does directly with the collection\'s own equality.',
      sourceCode,
      'Replace Any(x => x == value) with Contains(value).',
    )
  },
}
