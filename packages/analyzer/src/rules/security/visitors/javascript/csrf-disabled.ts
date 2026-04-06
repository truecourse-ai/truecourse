import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csrfDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/csrf-disabled',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    // csrf: false
    if (key?.text === 'csrf' && value?.text === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'CSRF protection disabled',
        'Setting csrf to false disables Cross-Site Request Forgery protection.',
        sourceCode,
        'Enable CSRF protection to prevent cross-site request forgery attacks.',
      )
    }

    return null
  },
}
