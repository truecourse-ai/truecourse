import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function isFstringPrefix(text: string): boolean {
  return text.startsWith('f"') || text.startsWith("f'") ||
    text.startsWith('f"""') || text.startsWith("f'''") ||
    text.startsWith('F"') || text.startsWith("F'") ||
    text.startsWith('F"""') || text.startsWith("F'''")
}

export const pythonFstringMissingPlaceholdersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fstring-missing-placeholders',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // f-strings in tree-sitter python start with f" or f' (or triple-quoted variants)
    if (!isFstringPrefix(text)) return null

    // Check if there's any { } interpolation
    if (!/{/.test(text)) {
      // If this f-string is part of an implicit concatenation (concatenated_string),
      // skip if ANY sibling string has placeholders — this is an intentional pattern
      // to split long f-strings: f"prefix " f"{variable}"
      if (node.parent?.type === 'concatenated_string') {
        for (const sibling of node.parent.namedChildren) {
          if (sibling.id === node.id) continue
          const sibText = sibling.text
          if (isFstringPrefix(sibText) && /{/.test(sibText)) {
            return null
          }
        }
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'f-string without placeholders',
        `\`${text.slice(0, 60)}\` is an f-string but contains no \`{...}\` interpolation — the \`f\` prefix is unnecessary or interpolation was forgotten.`,
        sourceCode,
        'Remove the `f` prefix if no interpolation is needed, or add `{expression}` placeholders.',
      )
    }

    return null
  },
}
