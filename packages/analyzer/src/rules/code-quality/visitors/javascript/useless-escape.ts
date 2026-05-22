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

    // Skip strings that are the value of a JSX `pattern` attribute on a
    // form input. The HTML `pattern` attribute is a regex parsed by the
    // browser, so `\d`, `\w`, `\s`, etc. are correct regex shorthand and
    // the backslash is required.
    if (node.parent?.type === 'jsx_attribute') {
      const propId = node.parent.namedChildren.find((c) => c.type === 'property_identifier')
      if (propId?.text === 'pattern') return null
    }

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
