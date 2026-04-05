import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const DEPRECATED_ATTRS: Record<string, string> = {
  isnull: 'isna',
  notnull: 'notna',
  ix: '.loc or .iloc',
}

export const pythonPandasDeprecatedAccessorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-deprecated-accessor',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    if (!attr) return null

    const replacement = DEPRECATED_ATTRS[attr.text]
    if (!replacement) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Deprecated pandas accessor .${attr.text}`,
      `\`.${attr.text}\` is deprecated — use \`.${replacement}\` instead.`,
      sourceCode,
      `Replace \`.${attr.text}\` with \`.${replacement}\`.`,
    )
  },
}
