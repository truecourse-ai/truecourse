import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const GENERIC_MESSAGES = [
  'something went wrong',
  'an error occurred',
  'error occurred',
  'internal server error',
  'oops',
  'try again later',
  'please try again',
]

export const pythonGenericErrorMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/generic-error-message',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    let text = node.text
    text = text.replace(/^[rubfRUBF]*['"]|['"]$/g, '').toLowerCase().trim()
    for (const msg of GENERIC_MESSAGES) {
      if (text === msg) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Generic error message',
          `Error message "${node.text}" is too vague. Include a specific error code or actionable detail.`,
          sourceCode,
          'Replace with a specific error message that includes an error code or actionable detail.',
        )
      }
    }
    return null
  },
}
