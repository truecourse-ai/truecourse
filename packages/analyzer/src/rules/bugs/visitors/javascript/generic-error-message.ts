import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

const GENERIC_MESSAGES = [
  'something went wrong',
  'an error occurred',
  'error occurred',
  'internal server error',
  'oops',
  'oops!',
  'try again later',
  'please try again',
]

export const genericErrorMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/generic-error-message',
  languages: JS_LANGUAGES,
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text.toLowerCase().replace(/['"` ]/g, '').trim()
    for (const msg of GENERIC_MESSAGES) {
      if (text === msg.replace(/ /g, '')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Generic error message',
          `Error message "${node.text}" is too vague to be actionable. Include an error code or specific detail to help with debugging.`,
          sourceCode,
          'Replace with a specific error message that includes an error code or actionable detail.',
        )
      }
    }
    return null
  },
}
