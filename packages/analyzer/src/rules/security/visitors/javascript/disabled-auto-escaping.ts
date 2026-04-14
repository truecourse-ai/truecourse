import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const disabledAutoEscapingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-auto-escaping',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // dangerouslySetInnerHTML
    if (node.type === 'jsx_attribute') {
      const name = node.namedChildren[0]
      if (name && name.text === 'dangerouslySetInnerHTML') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Disabled auto-escaping',
          'dangerouslySetInnerHTML bypasses React\'s XSS protections.',
          sourceCode,
          'Avoid dangerouslySetInnerHTML. Use safe rendering methods or sanitize input with DOMPurify.',
        )
      }
    }

    // element.innerHTML = ...
    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left')
      if (left?.type === 'member_expression') {
        const prop = left.childForFieldName('property')
        if (prop?.text === 'innerHTML') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Disabled auto-escaping',
            'Direct innerHTML assignment can lead to XSS vulnerabilities.',
            sourceCode,
            'Use textContent instead of innerHTML, or sanitize input with DOMPurify.',
          )
        }
      }
    }

    return null
  },
}
