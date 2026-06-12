import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * The O(n^2) anti-pattern is spreading the ACCUMULATOR itself on each
 * iteration (`acc.reduce((acc, x) => ({ ...acc, ...x }), {})`) — every pass
 * copies the whole accumulator. Spreading some other, fixed-size value while
 * mutating the accumulator in place (`acc[x.id] = { ...x.state, ... }; return acc`)
 * is linear and must not be flagged.
 */
function getAccumulatorName(callback: SyntaxNode): string | null {
  if (
    callback.type !== 'arrow_function' &&
    callback.type !== 'function_expression' &&
    callback.type !== 'function'
  ) {
    return null
  }
  const params = callback.childForFieldName('parameters')
  if (!params) return null
  const first = params.namedChildren.find((c) => c.type !== 'comment')
  if (!first) return null
  if (first.type === 'identifier') return first.text
  // TS wraps the binding in required_parameter / optional_parameter.
  const pattern = first.childForFieldName('pattern')
  if (pattern && pattern.type === 'identifier') return pattern.text
  return null
}

function spreadsIdentifier(node: SyntaxNode, name: string): boolean {
  if (node.type === 'spread_element') {
    const arg = node.namedChildren[0]
    if (arg && arg.type === 'identifier' && arg.text === name) return true
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && spreadsIdentifier(child, name)) return true
  }
  return false
}

export const spreadInReduceVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/spread-in-reduce',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'reduce') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const callback = args.namedChildren[0]
    if (!callback) return null

    const accName = getAccumulatorName(callback)
    if (!accName) return null

    // Only flag when the accumulator itself is spread (the actual O(n^2) shape).
    if (spreadsIdentifier(callback, accName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Spread operator in reduce callback',
        'Using spread in a reduce callback creates a new copy on every iteration, resulting in O(n^2) time complexity.',
        sourceCode,
        'Use Object.assign() or direct mutation of the accumulator instead of spread.',
      )
    }

    return null
  },
}
