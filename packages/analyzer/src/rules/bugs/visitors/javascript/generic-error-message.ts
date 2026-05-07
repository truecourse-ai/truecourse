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

// Object-literal keys that, when present as a sibling of the matched
// generic message, indicate a structured error/notification with
// specific detail elsewhere — the title's genericness is intentional.
// Toast/notification libraries (sonner, documenso's _ + msg, MUI, AntD,
// shadcn) all use a short title + detailed description shape.
const DETAIL_SIBLING_KEYS = new Set([
  'description', 'details', 'detail', 'message', 'cause', 'subtitle', 'body',
  'reason', 'help', 'hint',
])

export const genericErrorMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/generic-error-message',
  languages: JS_LANGUAGES,
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text.toLowerCase().replace(/['"` ]/g, '').trim()
    let matched = false
    for (const msg of GENERIC_MESSAGES) {
      if (text === msg.replace(/ /g, '')) { matched = true; break }
    }
    if (!matched) return null

    // Skip when this string is the value of an object-literal pair whose
    // sibling has a "detail" key with a non-empty value. The canonical
    // toast pattern is `{ title: 'Something went wrong', description:
    // '<specific reason>' }` — the title's genericness is intentional
    // and the description carries the actionable detail.
    let scope: typeof node.parent = node.parent
    while (scope && scope.type !== 'pair') scope = scope.parent
    if (scope && scope.type === 'pair') {
      const obj = scope.parent
      if (obj && obj.type === 'object') {
        for (const sibling of obj.namedChildren) {
          if (sibling.id === scope.id) continue
          if (sibling.type !== 'pair') continue
          const key = sibling.childForFieldName('key')
          if (!key) continue
          // Strip quotes for string-literal keys.
          const keyText = key.text.replace(/^['"`]|['"`]$/g, '')
          if (!DETAIL_SIBLING_KEYS.has(keyText)) continue
          const value = sibling.childForFieldName('value')
          // Empty-string values don't carry detail. Anything else
          // (string with content, template, function call returning
          // a localized string) is treated as detail.
          if (value && value.text.trim().length > 2) return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Generic error message',
      `Error message "${node.text}" is too vague to be actionable. Include an error code or specific detail to help with debugging.`,
      sourceCode,
      'Replace with a specific error message that includes an error code or actionable detail.',
    )
  },
}
