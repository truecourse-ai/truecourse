import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SENSITIVE_URL_PARAMS = /[?&](password|passwd|secret|token|api_?key|auth|access_token|refresh_token)=/i

export const sensitiveDataInUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sensitive-data-in-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^['"`]|['"`]$/g, '')

    if (SENSITIVE_URL_PARAMS.test(stripped)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Sensitive data in URL',
        'Password or token found in URL query parameter. URLs are logged in server logs and browser history.',
        sourceCode,
        'Send sensitive data in the request body or Authorization header instead of URL query parameters.',
      )
    }

    return null
  },
}
