import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `new Guid()` — the parameterless Guid constructor yields the all-zero Guid,
 * which is almost never the intent. Code wanting a fresh identifier means
 * `Guid.NewGuid()`; code wanting the empty sentinel should use the explicit and
 * self-documenting `Guid.Empty`. `new Guid("...")` and other parameterized
 * overloads are fine.
 */
export const csharpEmptyGuidConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-guid-constructor',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = node.childForFieldName('type')?.text
    if (typeName !== 'Guid' && typeName !== 'System.Guid') return null

    const args = node.childForFieldName('arguments')
    // No argument list at all → `new Guid { ... }` object initializer form, skip.
    if (!args) return null
    const realArgs = args.namedChildren.filter((c) => c?.type === 'argument')
    if (realArgs.length !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'new Guid() yields an all-zero Guid',
      'The parameterless Guid constructor produces the all-zero Guid, which is almost never intended.',
      sourceCode,
      'Use `Guid.NewGuid()` for a fresh identifier, or `Guid.Empty` to express the empty value explicitly.',
    )
  },
}
