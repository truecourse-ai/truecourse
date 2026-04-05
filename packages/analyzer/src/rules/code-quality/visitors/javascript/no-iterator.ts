import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-iterator',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression', 'pair'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'member_expression') {
      const prop = node.childForFieldName('property')
      if (prop?.text === '__iterator__') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          '__iterator__ usage',
          '`__iterator__` is non-standard and not supported in modern environments. Use the `Symbol.iterator` protocol instead.',
          sourceCode,
          'Replace `__iterator__` with `[Symbol.iterator]()` to use the standard iteration protocol.',
        )
      }
    }
    if (node.type === 'pair') {
      const key = node.childForFieldName('key')
      if (key?.text === '__iterator__' || key?.text === '"__iterator__"' || key?.text === "'__iterator__'") {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          '__iterator__ usage',
          '`__iterator__` is non-standard and not supported in modern environments. Use the `Symbol.iterator` protocol instead.',
          sourceCode,
          'Replace `__iterator__` with `[Symbol.iterator]()` to use the standard iteration protocol.',
        )
      }
    }
    return null
  },
}
