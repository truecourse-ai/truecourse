import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects use of datetime.min or datetime.max as sentinel values.
 * These can cause overflow issues when performing arithmetic or comparisons.
 */
export const pythonDatetimeMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-min-max',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')

    if (!obj || !attr) return null

    const attrName = attr.text
    if (attrName !== 'min' && attrName !== 'max') return null

    const objText = obj.text
    if (
      objText !== 'datetime' &&
      objText !== 'datetime.datetime' &&
      objText !== 'date' &&
      objText !== 'datetime.date' &&
      objText !== 'time' &&
      objText !== 'datetime.time'
    ) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `datetime.${attrName} used as sentinel value`,
      `\`${objText}.${attrName}\` is used as a sentinel value — this can cause overflow or comparison issues, especially when timezone-aware arithmetic is performed.`,
      sourceCode,
      `Use \`None\` as a sentinel value instead of \`${objText}.${attrName}\`, and handle the None case explicitly.`,
    )
  },
}
