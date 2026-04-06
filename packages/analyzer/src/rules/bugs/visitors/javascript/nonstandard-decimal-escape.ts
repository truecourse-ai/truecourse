import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const nonstandardDecimalEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nonstandard-decimal-escape',
  languages: JS_LANGUAGES,
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (/\\[89]/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Nonstandard decimal escape',
        `\`\\8\` and \`\\9\` are not valid escape sequences — they are non-octal decimal escapes.`,
        sourceCode,
        'Remove the backslash or use a proper escape sequence like `\\u0038` for `8`.',
      )
    }
    return null
  },
}
