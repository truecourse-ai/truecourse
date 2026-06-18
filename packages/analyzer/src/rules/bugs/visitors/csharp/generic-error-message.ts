import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpStringText } from '../../../_shared/csharp-helpers.js'

const GENERIC_MESSAGES = new Set([
  'something went wrong',
  'an error occurred',
  'error occurred',
  'internal server error',
  'oops',
  'try again later',
  'please try again',
])

/**
 * A string literal that is exactly a vague catch-all error message —
 * gives the user/operator nothing actionable.
 */
export const csharpGenericErrorMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/generic-error-message',
  languages: ['csharp'],
  nodeTypes: ['string_literal', 'verbatim_string_literal'],
  visit(node, filePath, sourceCode) {
    const text = getCSharpStringText(node)?.toLowerCase().trim().replace(/[.!]+$/, '')
    if (!text || !GENERIC_MESSAGES.has(text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Generic error message',
      `Error message ${node.text} is too vague. Include a specific error code or actionable detail.`,
      sourceCode,
      'Replace with a specific error message that includes an error code or actionable detail.',
    )
  },
}
