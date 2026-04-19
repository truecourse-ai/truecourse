import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function containsSpread(node: SyntaxNode): boolean {
  if (node.type === 'spread_element') return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsSpread(child)) return true
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

    // Check if callback body contains spread_element
    if (containsSpread(callback)) {
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
