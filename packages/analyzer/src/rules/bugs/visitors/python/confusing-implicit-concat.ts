import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects adjacent string/byte literals that are implicitly concatenated in contexts
 * where this looks like a mistake (e.g., inside a list or set, or as function arguments
 * where two separate strings were likely intended). */
export const pythonConfusingImplicitConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/confusing-implicit-concat',
  languages: ['python'],
  nodeTypes: ['list', 'set', 'argument_list', 'tuple'],
  visit(node, filePath, sourceCode) {
    // Look for concatenated_string nodes (implicit concat) inside collections/arg lists
    for (const child of node.namedChildren) {
      if (child.type === 'concatenated_string') {
        // Skip when any adjacent string part is an f-string — this is an intentional pattern
        // to split long f-strings across lines: "prefix " f"{variable}"
        let hasFormatString = false
        for (const part of child.namedChildren) {
          const partText = part.text
          if (partText.startsWith('f"') || partText.startsWith("f'") ||
              partText.startsWith('f"""') || partText.startsWith("f'''") ||
              partText.startsWith('F"') || partText.startsWith("F'") ||
              partText.startsWith('F"""') || partText.startsWith("F'''")) {
            hasFormatString = true
            break
          }
        }
        if (hasFormatString) continue

        // Skip multi-line concat that's intentional readability splitting:
        //   1. Every part except possibly the last ends in whitespace
        //      (sentence fragments).
        //   2. OR the joined length is > 60 chars (long XPath / SQL / S3
        //      key split for line width). `["first"\n"second"]` (short,
        //      no trailing whitespace) still fires - it's far more
        //      likely to be a missing comma.
        const isMultiLine = child.startPosition.row !== child.endPosition.row
        if (isMultiLine) {
          const parts = child.namedChildren
          let allButLastEndWithSpace = parts.length > 1
          for (let i = 0; i < parts.length - 1; i++) {
            const t = parts[i].text
            // Strip the trailing quote(s) and look at the last content char.
            const stripped = t.replace(/['"]+$/, '')
            const lastChar = stripped.charAt(stripped.length - 1)
            if (lastChar !== ' ' && lastChar !== '\\' && lastChar !== '\t') {
              allButLastEndWithSpace = false
              break
            }
          }
          if (allButLastEndWithSpace) continue
          const totalLen = parts.reduce((sum, p) => sum + p.text.length, 0)
          if (totalLen > 60) continue
        }

        // This is implicit string concatenation inside a list/set/args/tuple
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'Confusing implicit string concatenation',
          `Implicit string concatenation \`${child.text.slice(0, 50)}${child.text.length > 50 ? '...' : ''}\` inside a ${node.type.replace(/_/g, ' ')} — adjacent string literals are joined at compile time. If two separate strings were intended, add a comma between them.`,
          sourceCode,
          'If you meant two separate strings, add a comma. If intentional concatenation, use explicit `+` or join into a single string.',
        )
      }
    }

    return null
  },
}
