import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const linkTargetBlankVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/link-target-blank',
  languages: ['tsx'],
  nodeTypes: ['jsx_self_closing_element', 'jsx_opening_element'],
  visit(node, filePath, sourceCode) {
    // Check if it's an <a> tag
    const tagName = node.namedChildren[0]
    if (!tagName || tagName.text !== 'a') return null

    let hasTargetBlank = false
    let hasRelNoopener = false

    for (const child of node.namedChildren) {
      if (child.type === 'jsx_attribute') {
        const attrName = child.namedChildren[0]
        if (!attrName) continue

        if (attrName.text === 'target') {
          const attrValue = child.namedChildren[1]
          if (attrValue) {
            const val = attrValue.text.replace(/['"{}]/g, '').toLowerCase()
            if (val === '_blank') hasTargetBlank = true
          }
        }

        if (attrName.text === 'rel') {
          const attrValue = child.namedChildren[1]
          if (attrValue) {
            const val = attrValue.text.replace(/['"{}]/g, '').toLowerCase()
            if (val.includes('noopener')) hasRelNoopener = true
          }
        }
      }
    }

    if (hasTargetBlank && !hasRelNoopener) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe target="_blank" link',
        '<a target="_blank"> without rel="noopener" allows reverse tabnabbing attacks.',
        sourceCode,
        'Add rel="noopener noreferrer" to links with target="_blank".',
      )
    }

    return null
  },
}
