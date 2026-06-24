import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * An `abstract` class is meant to declare members that subclasses must
 * implement. One with zero abstract members forces instantiation through a
 * subclass for no contractual reason — it should be either a concrete base
 * class (drop `abstract`) or, if it carries no implementation at all, an
 * interface. Partial classes are skipped because the abstract members may
 * live in another file.
 */
const MEMBER_TYPES = new Set([
  'method_declaration', 'property_declaration', 'event_declaration',
  'indexer_declaration',
])

function hasAbstractMember(body: SyntaxNode): boolean {
  return body.namedChildren.some(
    (c) => c && MEMBER_TYPES.has(c.type) && hasCSharpModifier(c, 'abstract'),
  )
}

export const csharpAbstractClassWithoutAbstractMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/abstract-class-without-abstract-members',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'abstract')) return null
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    if (hasAbstractMember(body)) return null

    const name = node.childForFieldName('name')?.text ?? 'class'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Abstract class without abstract members',
      `Abstract class \`${name}\` declares no abstract members, so it should be a concrete base class or an interface instead.`,
      sourceCode,
      'Add abstract members, drop the `abstract` modifier, or convert the type to an interface.',
    )
  },
}
