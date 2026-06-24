import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * `protected` grants access to derived types — but a `sealed` class can never be
 * derived from, so `protected` (and `protected internal`) members on it are
 * effectively `private`/`internal` and mislead the reader. The check fires on a
 * member of a `sealed` `class_declaration` carrying the `protected` modifier.
 * `sealed override` members are exempt: a sealed override legitimately keeps the
 * `protected` accessibility of the member it overrides.
 */
const MEMBER_TYPES = new Set([
  'field_declaration', 'property_declaration', 'method_declaration',
  'event_declaration', 'event_field_declaration', 'indexer_declaration',
])

export const csharpSealedClassProtectedMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/sealed-class-protected-member',
  languages: ['csharp'],
  nodeTypes: [...MEMBER_TYPES],
  visit(node: SyntaxNode, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'protected')) return null
    // A sealed override keeps the base member's protected accessibility.
    if (hasCSharpModifier(node, 'override')) return null

    const cls = node.parent?.parent
    if (cls?.type !== 'class_declaration') return null
    if (!hasCSharpModifier(cls, 'sealed')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'protected member on a sealed class',
      '`protected` is meaningless on a `sealed` class because nothing can derive from it.',
      sourceCode,
      'Make the member `private` (or `internal`), since the sealed class has no derived types.',
    )
  },
}
