import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { importsPandas } from '../../../_shared/python-framework-detection.js'

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
    // Gate on file actually using pandas. `.isnull` in particular collides
    // with SQLAlchemy filters and custom code outside pandas contexts.
    if (!importsPandas(node)) return null

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
