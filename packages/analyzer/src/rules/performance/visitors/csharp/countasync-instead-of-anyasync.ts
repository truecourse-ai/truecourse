import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `await xs.CountAsync() == 0` round-trips a `COUNT(*)` (or full enumeration)
 * to learn only whether any row exists, where `AnyAsync()` issues an
 * `EXISTS`-style query that stops at the first hit. Fires when an awaited,
 * argument-less `CountAsync()`/`LongCountAsync()` is compared against `0`.
 */
const COUNT_METHODS = new Set(['CountAsync', 'LongCountAsync'])
const EMPTINESS_OPERATORS = new Set(['==', '!=', '>', '<', '>=', '<='])

function isZeroLiteral(node: SyntaxNode): boolean {
  return node.type === 'integer_literal' && node.text === '0'
}

function awaitedCountAsync(node: SyntaxNode): boolean {
  if (node.type !== 'await_expression') return false
  const call = node.namedChildren.find(Boolean)
  if (!call || call.type !== 'invocation_expression') return false
  if (!COUNT_METHODS.has(getCSharpMethodName(call))) return false
  return getCSharpArguments(call).length === 0
}

export const csharpCountAsyncInsteadOfAnyAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/countasync-instead-of-anyasync',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text ?? ''
    if (!EMPTINESS_OPERATORS.has(op)) return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const onLeft = awaitedCountAsync(left) && isZeroLiteral(right)
    const onRight = awaitedCountAsync(right) && isZeroLiteral(left)
    if (!onLeft && !onRight) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'CountAsync used where AnyAsync suffices',
      'Comparing CountAsync() against zero counts every matching row to answer an existence question. AnyAsync() translates to an EXISTS query that short-circuits.',
      sourceCode,
      'Replace the CountAsync() comparison with AnyAsync() (or !AnyAsync() for the empty case).',
    )
  },
}
