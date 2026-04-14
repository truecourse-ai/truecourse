import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const ipForwardingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ip-forwarding',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const index = node.childForFieldName('index')

    if (!obj || !index) return null

    const indexText = index.text.replace(/['"]/g, '').toLowerCase()
    if (indexText !== 'x-forwarded-for') return null

    // Check that it's accessing headers
    if (obj.text.includes('headers')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Untrusted IP forwarding header',
        'Accessing X-Forwarded-For header directly. This header can be spoofed by clients.',
        sourceCode,
        'Use a trusted proxy configuration (e.g., app.set("trust proxy")) and req.ip instead.',
      )
    }

    return null
  },
}
