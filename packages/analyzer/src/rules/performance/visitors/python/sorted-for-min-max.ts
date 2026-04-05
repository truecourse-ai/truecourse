import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const sortedForMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sorted-for-min-max',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call') return null

    const fn = value.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'sorted') return null

    const subscript = node.childForFieldName('subscript')
    if (!subscript) return null

    const indexText = subscript.text
    // sorted(...)[0] → min(), sorted(...)[-1] → max()
    if (indexText === '0' || indexText === '-1') {
      const replacement = indexText === '0' ? 'min()' : 'max()'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `sorted()[${indexText}] instead of ${replacement}`,
        `Using sorted(...)[${indexText}] is O(n log n) when ${replacement} is O(n).`,
        sourceCode,
        `Replace sorted(...)[${indexText}] with ${replacement}.`,
      )
    }

    return null
  },
}
