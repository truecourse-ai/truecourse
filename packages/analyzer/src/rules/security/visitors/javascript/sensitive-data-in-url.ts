import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Only flag truly sensitive params — not invitation/invite tokens which are designed to be URL-transported
const SENSITIVE_URL_PARAMS = /[?&](password|passwd|secret|api_?key|auth|access_token|refresh_token|session|jwt|bearer|session_?id)=/i

// Invitation/invite tokens are designed to be transported via URL — not sensitive
const INVITATION_PARAM = /[?&](invitation|invite)[_-]?(token|code|id|key)?=/i

export const sensitiveDataInUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sensitive-data-in-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^['"`]|['"`]$/g, '')

    if (SENSITIVE_URL_PARAMS.test(stripped)) {
      // Skip invitation/invite tokens — they are meant to be URL-transported
      if (INVITATION_PARAM.test(stripped)) return null

      // Also check the broader context: if the variable name or surrounding code
      // references invitation/invite, skip it
      const surroundingText = node.parent?.text ?? ''
      if (/invit(ation|e)/i.test(surroundingText)) return null

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
