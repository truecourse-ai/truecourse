import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingRequestBodySizeLimitVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-request-body-size-limit',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check main app/server files
    const lowerPath = filePath.toLowerCase()
    if (!lowerPath.includes('app.') && !lowerPath.includes('server.')) return null

    const text = sourceCode

    // Check if express.json() or bodyParser is used
    if (!text.includes('express.json(') && !text.includes('bodyParser.json(') && !text.includes('express.urlencoded(')) {
      return null
    }

    // Check if limit is set
    if (text.includes("limit:") || text.includes("limit':") || text.includes('limit":')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'No request body size limit',
      "express.json() or bodyParser.json() used without a 'limit' option. Large payloads may cause OOM.",
      sourceCode,
      "Add a limit: express.json({ limit: '10kb' })",
    )
  },
}
