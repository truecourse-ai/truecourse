import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const disabledResourceIntegrityVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-resource-integrity',
  languages: ['tsx'],
  nodeTypes: ['jsx_self_closing_element', 'jsx_opening_element'],
  visit(node, filePath, sourceCode) {
    const tagName = node.namedChildren[0]
    if (!tagName || (tagName.text !== 'script' && tagName.text !== 'link')) return null

    let hasSrc = false
    let hasIntegrity = false
    let isExternal = false

    for (const child of node.namedChildren) {
      if (child.type === 'jsx_attribute') {
        const attrName = child.namedChildren[0]
        if (!attrName) continue

        if (attrName.text === 'src' || attrName.text === 'href') {
          hasSrc = true
          const attrValue = child.namedChildren[1]
          if (attrValue) {
            const val = attrValue.text.replace(/['"{}]/g, '')
            if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')) {
              isExternal = true
            }
          }
        }

        if (attrName.text === 'integrity') {
          hasIntegrity = true
        }
      }
    }

    if (hasSrc && isExternal && !hasIntegrity) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing subresource integrity',
        `<${tagName.text}> loads an external resource without an integrity attribute. A compromised CDN could serve malicious code.`,
        sourceCode,
        'Add an integrity attribute with the resource hash (e.g., integrity="sha384-...").',
      )
    }

    return null
  },
}
