import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const indexOfPositiveCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/index-of-positive-check',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['>', '>=', '<', '<=', '===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    function isIndexOfCall(n: SyntaxNode): boolean {
      if (n.type !== 'call_expression') return false
      const fn = n.childForFieldName('function')
      if (!fn || fn.type !== 'member_expression') return false
      const prop = fn.childForFieldName('property')
      return prop?.text === 'indexOf' || prop?.text === 'lastIndexOf'
    }

    // Flag any comparison to a non-negative integer (0 or positive) — only -1 is meaningful
    function isNonNegativeNumber(n: SyntaxNode): boolean {
      if (n.type !== 'number') return false
      const val = Number(n.text)
      return Number.isInteger(val) && val >= 0
    }

    if (isIndexOfCall(left) && isNonNegativeNumber(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'indexOf compared to positive number',
        `\`indexOf()\` returns -1 when not found. Comparing to \`${right.text}\` misses the case where the element is at index 0. Use \`!== -1\` to check if found.`,
        sourceCode,
        'Compare to -1: use `indexOf(x) !== -1` (found) or `indexOf(x) === -1` (not found).',
      )
    }

    if (isIndexOfCall(right) && isNonNegativeNumber(left)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'indexOf compared to positive number',
        `\`indexOf()\` returns -1 when not found. Comparing to \`${left.text}\` misses the case where the element is at index 0. Use \`!== -1\` to check if found.`,
        sourceCode,
        'Compare to -1: use `indexOf(x) !== -1` (found) or `indexOf(x) === -1` (not found).',
      )
    }

    return null
  },
}
