import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-escape',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const quoteChar = text[0]
    if (quoteChar !== '"' && quoteChar !== "'") return null

    const validEscapes = new Set(['n', 'r', 't', 'b', 'f', 'v', '0', '\\', quoteChar, 'u', 'x', '\n'])

    let i = 1
    while (i < text.length - 1) {
      if (text[i] === '\\' && i + 1 < text.length - 1) {
        const next = text[i + 1]
        if (!validEscapes.has(next) && next !== '\r') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Unnecessary escape character',
            `Unnecessary escape \`\\${next}\` in string — the backslash has no effect here.`,
            sourceCode,
            `Remove the backslash: use \`${next}\` instead of \`\\${next}\`.`,
          )
        }
        i += 2
      } else {
        i++
      }
    }
    return null
  },
}
