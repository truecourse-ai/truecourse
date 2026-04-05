import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from './_helpers.js'

export const substringOverStartsEndsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/substring-over-starts-ends',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '===' || c.type === '==' || c.type === '!==' || c.type === '!=')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    function isIndexOfZero(call: SyntaxNode, zero: SyntaxNode): boolean {
      if (call.type !== 'call_expression') return false
      if (zero.text !== '0') return false
      const fn = call.childForFieldName('function')
      if (fn?.type !== 'member_expression') return false
      const prop = fn.childForFieldName('property')
      return prop?.text === 'indexOf'
    }

    if (isIndexOfZero(left, right) || isIndexOfZero(right, left)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer startsWith()',
        '`str.indexOf(x) === 0` can be replaced with `str.startsWith(x)` for clarity.',
        sourceCode,
        'Replace `str.indexOf(x) === 0` with `str.startsWith(x)`.',
      )
    }

    return null
  },
}
