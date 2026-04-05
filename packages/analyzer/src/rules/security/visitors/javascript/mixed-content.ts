import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const mixedContentVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mixed-content',
  languages: ['tsx'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    const attrName = node.namedChildren[0]
    if (!attrName) return null

    if (attrName.text !== 'src' && attrName.text !== 'href' && attrName.text !== 'action') return null

    const attrValue = node.namedChildren[1]
    if (!attrValue) return null

    const val = attrValue.text.replace(/['"{}]/g, '')
    if (val.startsWith('http://') && !val.startsWith('http://localhost') && !val.startsWith('http://127.0.0.1')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Mixed content',
        `Loading HTTP resource "${val}" in a JSX attribute. This causes mixed content warnings and security issues on HTTPS pages.`,
        sourceCode,
        'Use HTTPS URLs or protocol-relative URLs (//) for external resources.',
      )
    }

    return null
  },
}
