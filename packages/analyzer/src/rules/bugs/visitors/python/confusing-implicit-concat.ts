import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects adjacent string/byte literals that are implicitly concatenated in contexts
 * where this looks like a mistake (e.g., inside a list or set, or as function arguments
 * where two separate strings were likely intended).
 * S5799: Confusing implicit string/byte concatenation.
 */
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
