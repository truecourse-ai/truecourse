import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ANGULAR_BYPASS_METHODS = new Set([
  'bypassSecurityTrustHtml',
  'bypassSecurityTrustStyle',
  'bypassSecurityTrustScript',
  'bypassSecurityTrustUrl',
  'bypassSecurityTrustResourceUrl',
])

export const angularSanitizationBypassVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/angular-sanitization-bypass',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (ANGULAR_BYPASS_METHODS.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Angular sanitization bypass',
        `${methodName}() disables Angular's built-in XSS protection. Ensure input is sanitized manually.`,
        sourceCode,
        'Avoid bypassSecurityTrust* methods. If required, ensure all input is thoroughly sanitized first.',
      )
    }

    return null
  },
}
