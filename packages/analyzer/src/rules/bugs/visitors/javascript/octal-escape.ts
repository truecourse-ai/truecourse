import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const octalEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/octal-escape',
  languages: JS_LANGUAGES,
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Check for octal escape sequences: \0xx (2+ octal digits) or \1-\7 followed by optional octal digits
    // \012 = backslash 0 1 2 (octal for 10), \7 = single digit octal (valid \7)
    if (/\\[1-7][0-7]*/.test(text) || /\\0[0-7]+/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Octal escape sequence',
        `String contains a deprecated octal escape sequence — use Unicode or hex escapes instead.`,
        sourceCode,
        'Replace octal escapes like `\\012` with `\\n` or `\\x0a`.',
      )
    }
    return null
  },
}
