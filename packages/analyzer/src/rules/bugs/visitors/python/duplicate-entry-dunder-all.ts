import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects duplicate entries in __all__ list/tuple.
 * e.g., __all__ = ["foo", "bar", "foo"]  — "foo" appears twice
 */
export const pythonDuplicateEntryDunderAllVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-entry-dunder-all',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    if (left.type !== 'identifier' || left.text !== '__all__') return null

    // __all__ should be a list or tuple
    if (right.type !== 'list' && right.type !== 'tuple') return null

    // Collect string entries
    const seen = new Map<string, number>()
    const duplicates: string[] = []

    for (const item of right.namedChildren) {
      let value: string | null = null
      if (item.type === 'string') {
        // Strip quotes
        const text = item.text
        value = text.replace(/^["']+|["']+$/g, '')
      }

      if (value !== null) {
        const count = (seen.get(value) ?? 0) + 1
        seen.set(value, count)
        if (count === 2) {
          duplicates.push(value)
        }
      }
    }

    if (duplicates.length === 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Duplicate entry in __all__',
      `\`__all__\` contains duplicate entries: ${duplicates.map((d) => `"${d}"`).join(', ')} — likely a copy-paste error.`,
      sourceCode,
      `Remove duplicate entries from \`__all__\`.`,
    )
  },
}
