import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpGeneratedSource } from './_helpers.js'

/**
 * Legal-but-pointless escapes. C# rejects unknown escapes at compile time
 * (CS1009), so the only flaggable cases are the cross-quote ones:
 *   - `\'` inside a string literal (only needed in char literals)
 *   - `\"` inside a char literal (only needed in string literals)
 */
export const csharpUselessEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-escape',
  languages: ['csharp'],
  nodeTypes: ['string_literal', 'character_literal'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null

    const pointless = node.type === 'string_literal' ? "\\'" : '\\"'
    const bare = pointless[1]

    for (const child of node.namedChildren) {
      if (child?.type !== 'escape_sequence') continue
      if (child.text !== pointless) continue
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary escape character',
        `\`${pointless}\` in a ${node.type === 'string_literal' ? 'string' : 'char'} literal — the backslash has no effect here.`,
        sourceCode,
        `Remove the backslash: use \`${bare}\` instead of \`${pointless}\`.`,
      )
    }
    return null
  },
}
