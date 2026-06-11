import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isStringNode, staticStringText } from './_helpers.js'

/**
 * Passwords/tokens placed in URL query strings inside string literals. URLs
 * end up in server logs, proxies and browser history. Invitation/invite
 * tokens are designed for URL transport and are excluded (mirrors the JS
 * visitor).
 */
const SENSITIVE_URL_PARAMS = /[?&](password|passwd|secret|api_?key|auth|access_token|refresh_token|session|jwt|bearer|session_?id)=/i
const INVITATION_PARAM = /[?&](invitation|invite)[_-]?(token|code|id|key)?=/i

export const csharpSensitiveDataInUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sensitive-data-in-url',
  languages: ['csharp'],
  nodeTypes: ['string_literal', 'verbatim_string_literal', 'interpolated_string_expression', 'raw_string_literal'],
  visit(node, filePath, sourceCode) {
    if (!isStringNode(node)) return null
    const text = staticStringText(node)
    if (!SENSITIVE_URL_PARAMS.test(text)) return null
    if (INVITATION_PARAM.test(text)) return null
    if (/invit(ation|e)/i.test(node.parent?.text ?? '')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Sensitive data in URL',
      'Password or token in a URL query parameter. URLs are logged by servers and proxies and kept in browser history.',
      sourceCode,
      'Send sensitive data in the request body or Authorization header instead of the query string.',
    )
  },
}
