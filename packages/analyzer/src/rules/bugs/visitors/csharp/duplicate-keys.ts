import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Duplicate constant keys in a dictionary initializer:
 *   - index form `["key"] = …` — the later entry silently overwrites
 *   - Add form `{ "key", … }` on a Dictionary — throws ArgumentException
 *     at runtime
 * Only literal / enum-member keys are compared (computed keys can differ).
 */
function keyText(n: SyntaxNode): string | null {
  if (
    n.type === 'string_literal' || n.type === 'verbatim_string_literal' ||
    n.type === 'integer_literal' || n.type === 'character_literal' ||
    n.type === 'member_access_expression'
  ) {
    return n.text
  }
  return null
}

export const csharpDuplicateKeysVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-keys',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'implicit_object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const initializer = node.childForFieldName('initializer')
    if (!initializer) return null
    const typeName = node.childForFieldName('type')?.text ?? ''
    const isDictionary = /Dictionary|Hashtable/.test(typeName)

    const seen = new Map<string, SyntaxNode>()
    for (const entry of initializer.namedChildren) {
      if (!entry) continue
      let key: string | null = null

      // Index form: ["key"] = value
      if (entry.type === 'assignment_expression') {
        const left = entry.childForFieldName('left')
        if (left?.type === 'element_binding_expression') {
          const arg = left.namedChildren[0]?.namedChildren[0] ?? left.namedChildren[0]
          if (arg) key = keyText(arg.type === 'argument' ? (arg.namedChildren[0] ?? arg) : arg)
        }
      }

      // Add form: { "key", value } — only meaningful on dictionary types
      if (entry.type === 'initializer_expression' && isDictionary) {
        const first = entry.namedChildren[0]
        if (first) key = keyText(first)
      }

      if (key === null) continue
      const previous = seen.get(key)
      if (previous) {
        return makeViolation(
          this.ruleKey, entry, filePath, 'high',
          'Duplicate dictionary key',
          `Key ${key} appears more than once in this initializer — ${entry.type === 'initializer_expression' ? 'the Add-style initializer throws ArgumentException at runtime' : 'the later entry silently overwrites the earlier one'}.`,
          sourceCode,
          'Remove or rename the duplicate key.',
        )
      }
      seen.set(key, entry)
    }
    return null
  },
}
