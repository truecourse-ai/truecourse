import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// True when the subtree spreads the given accumulator identifier
// (`{ ...acc, ... }` / `[ ...acc ]`). Only spreading the *accumulator* on
// every iteration re-copies the result-so-far and causes O(n^2) behaviour.
// Spreading some other fixed-size object (e.g. `{ ...row, seen: true }`)
// while the accumulator is mutated in place is constant work per element.
function spreadsAccumulator(node: SyntaxNode, accName: string): boolean {
  if (node.type === 'spread_element') {
    const target = node.namedChildren[0]
    if (target?.type === 'identifier' && target.text === accName) return true
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && spreadsAccumulator(child, accName)) return true
  }
  return false
}

// Resolve the accumulator parameter name (the first callback parameter).
function accumulatorName(callback: SyntaxNode): string | null {
  // `acc => ...` — the parameter is a bare identifier.
  const params = callback.childForFieldName('parameters')
  if (!params) {
    const single = callback.childForFieldName('parameter')
    if (single?.type === 'identifier') return single.text
    return null
  }
  const first = params.namedChildren[0]
  if (!first) return null
  if (first.type === 'identifier') return first.text
  // `required_parameter` / `optional_parameter` wrap the pattern.
  const pattern = first.childForFieldName('pattern')
  if (pattern?.type === 'identifier') return pattern.text
  return null
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

    const accName = accumulatorName(callback)
    if (!accName) return null

    // Only flag when the accumulator itself is spread on each iteration.
    if (spreadsAccumulator(callback, accName)) {
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
