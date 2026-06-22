import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A public property whose type is an array hands every caller a mutable,
 * directly-indexable copy of internal state; readers naturally assume a
 * property is cheap and side-effect-free, yet each `get` either leaks the
 * backing array or allocates a fresh one. CA1819 recommends returning a
 * read-only view (`IReadOnlyList<T>`) or a method whose `GetXxx()` name signals
 * the cost. The check targets a public/protected `property_declaration` whose
 * declared type is an `array_type`. A `byte[]` property is excluded — byte
 * arrays are the idiomatic shape for binary payloads and trip the rule
 * constantly.
 */

function declaredType(node: SyntaxNode): SyntaxNode | null {
  const nameNode = node.childForFieldName('name')
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.id === nameNode?.id) break
    if (child.type === 'modifier' || child.type === 'attribute_list') continue
    return child
  }
  return null
}

export const csharpPropertyReturnsArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/property-returns-array',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    if (hasCSharpModifier(node, 'private') || hasCSharpModifier(node, 'internal')) return null
    if (!hasCSharpModifier(node, 'public') && !hasCSharpModifier(node, 'protected')) return null

    const type = declaredType(node)
    if (type?.type !== 'array_type') return null

    const element = type.namedChildren[0]
    if (element?.type === 'predefined_type' && element.text === 'byte') return null

    const name = node.childForFieldName('name')?.text ?? 'property'
    return makeViolation(
      this.ruleKey, node.childForFieldName('name') ?? node, filePath, 'low',
      'Property returns an array',
      `Property \`${name}\` returns an array, which leaks mutable internal state or allocates a copy on every access (CA1819).`,
      sourceCode,
      `Return a read-only view such as \`IReadOnlyList<T>\`, or expose a \`Get${name}()\` method to signal the cost.`,
    )
  },
}
