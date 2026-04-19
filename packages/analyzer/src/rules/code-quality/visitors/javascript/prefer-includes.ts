import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const preferIncludesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-includes',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '!==' || c.type === '===' || c.type === '>=' || c.type === '<')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    function isIndexOfCall(n: SyntaxNode): boolean {
      if (n.type !== 'call_expression') return false
      const fn = n.childForFieldName('function')
      if (fn?.type !== 'member_expression') return false
      const prop = fn.childForFieldName('property')
      return prop?.text === 'indexOf'
    }

    function isNegOne(n: SyntaxNode): boolean {
      if (n.type === 'number' && n.text === '-1') return true
      if (n.type === 'unary_expression') {
        const op = n.children[0]
        const operand = n.children[1]
        return op?.text === '-' && operand?.text === '1'
      }
      return false
    }

    function isZero(n: SyntaxNode): boolean {
      return n.type === 'number' && n.text === '0'
    }

    const leftIsIndexOf = isIndexOfCall(left)
    const rightIsIndexOf = isIndexOfCall(right)

    if (!leftIsIndexOf && !rightIsIndexOf) return null

    const otherNode = leftIsIndexOf ? right : left

    const valid = isNegOne(otherNode) || isZero(otherNode)
    if (!valid) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer includes()',
      '`indexOf() !== -1` can be replaced with the cleaner `includes()` method.',
      sourceCode,
      'Replace `arr.indexOf(x) !== -1` with `arr.includes(x)`.',
    )
  },
}
