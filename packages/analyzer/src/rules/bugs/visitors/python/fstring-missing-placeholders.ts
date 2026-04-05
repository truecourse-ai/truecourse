import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFstringMissingPlaceholdersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fstring-missing-placeholders',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // f-strings in tree-sitter python start with f" or f' (or triple-quoted variants)
    if (!text.startsWith('f"') && !text.startsWith("f'") && !text.startsWith('f"""') && !text.startsWith("f'''")) return null

    // Check if there's any { } interpolation
    if (!/{/.test(text)) {
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
