import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const legacyHasOwnPropertyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/legacy-has-own-property',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop || prop.text !== 'call') return null
    const obj = fn.childForFieldName('object')
    if (!obj) return null

    if (obj.text.endsWith('hasOwnProperty')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Legacy hasOwnProperty usage',
        '`hasOwnProperty.call()` should be replaced with `Object.hasOwn()` which is cleaner and safer.',
        sourceCode,
        'Replace `Object.prototype.hasOwnProperty.call(obj, key)` with `Object.hasOwn(obj, key)`.',
      )
    }

    return null
  },
}
