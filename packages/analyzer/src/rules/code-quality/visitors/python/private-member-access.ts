import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPrivateMemberAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/private-member-access',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    if (!attr) return null
    const attrName = attr.text
    if (!attrName.startsWith('_') || attrName.startsWith('__')) return null

    const obj = node.childForFieldName('object')
    if (!obj) return null

    // Skip self._attr and cls._attr — those are internal access
    if (obj.type === 'identifier' && (obj.text === 'self' || obj.text === 'cls')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'External access to private member',
      `Accessing \`${obj.text}.${attrName}\` — names starting with \`_\` are private and not part of the public API.`,
      sourceCode,
      'Use the public API instead of accessing private members.',
    )
  },
}
