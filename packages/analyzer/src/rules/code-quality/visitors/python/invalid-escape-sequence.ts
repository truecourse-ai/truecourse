import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const VALID_ESCAPES = new Set(['\\', "'", '"', 'a', 'b', 'f', 'n', 'r', 't', 'v', '0', '\n', 'x', 'u', 'U', 'N', 'o', '1', '2', '3', '4', '5', '6', '7'])

export const pythonInvalidEscapeSequenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/invalid-escape-sequence',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Skip raw strings (r"...", r'...', rb"...", etc.)
    if (/^[rRbBuU]*r/i.test(text)) return null
    // Skip byte strings
    if (text.startsWith('b"') || text.startsWith("b'") || text.startsWith('B"') || text.startsWith("B'")) return null

    // Find backslash sequences
    const content = text.replace(/^[bBuUfF]*['"]/, '').replace(/['"]$/, '')
    let i = 0
    while (i < content.length) {
      if (content[i] === '\\' && i + 1 < content.length) {
        const next = content[i + 1]
        if (!VALID_ESCAPES.has(next)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Invalid escape sequence',
            `String contains invalid escape sequence \`\\${next}\` — use a raw string \`r"..."\` or double the backslash \`\\\\${next}\`.`,
            sourceCode,
            'Prefix the string with `r` to make it a raw string, or escape the backslash with `\\\\`.',
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
