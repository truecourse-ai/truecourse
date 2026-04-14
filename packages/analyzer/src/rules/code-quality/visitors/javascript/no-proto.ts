import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noProtoVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-proto',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    const prop = node.childForFieldName('property')
    if (prop?.text === '__proto__') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        '__proto__ usage',
        '`__proto__` is deprecated. Use `Object.getPrototypeOf()` or `Object.setPrototypeOf()` instead.',
        sourceCode,
        'Replace __proto__ with Object.getPrototypeOf() or Object.setPrototypeOf().',
      )
    }
    return null
  },
}
