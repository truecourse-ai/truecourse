import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SET_TYPES = new Set(['HashSet', 'SortedSet'])

/**
 * `new HashSet<T> { "a", "b", "a" }` — the collection initializer calls
 * Add() per element and HashSet.Add silently ignores duplicates, so the
 * repeated element is almost certainly a typo for a different value.
 */
export const csharpDuplicateSetValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-set-value',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const type = node.childForFieldName('type')
    const typeName = type?.type === 'generic_name'
      ? (type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (type?.text ?? '')
    if (!SET_TYPES.has(typeName)) return null

    const initializer = node.childForFieldName('initializer')
    if (!initializer) return null

    const seen = new Set<string>()
    for (const element of initializer.namedChildren) {
      if (!element) continue
      // Nested initializers / index assignments are not simple set elements.
      if (element.type === 'initializer_expression' || element.type === 'assignment_expression') return null
      const value = element.text
      if (seen.has(value)) {
        return makeViolation(
          this.ruleKey, element, filePath, 'medium',
          'Duplicate set value',
          `Value \`${value}\` appears more than once in the ${typeName} initializer — the duplicate is silently ignored.`,
          sourceCode,
          'Remove the duplicate value from the set initializer.',
        )
      }
      seen.add(value)
    }
    return null
  },
}
