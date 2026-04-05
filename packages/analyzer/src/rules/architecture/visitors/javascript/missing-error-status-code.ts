import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingErrorStatusCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-error-status-code',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Check if this catch is inside a route handler
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    // Check if body sends a response
    if (!bodyText.includes('res.json(') && !bodyText.includes('res.send(')) return null

    // Check if status is set
    if (bodyText.includes('.status(') || bodyText.includes('.sendStatus(')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch block sends response without error status code',
      'Catch block sends a response without setting an error status code (e.g., 500). Client will receive 200.',
      sourceCode,
      'Add res.status(500) before res.json() in the catch block.',
    )
  },
}
