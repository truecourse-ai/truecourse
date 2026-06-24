import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Object members whose base implementation is reference identity. */
const OBJECT_MEMBERS = new Set(['GetHashCode', 'Equals'])

/** The nearest enclosing class_declaration, or null. */
function enclosingClass(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'class_declaration') return current
    current = current.parent
  }
  return null
}

/**
 * True only when the class has no base list at all, so its base class is
 * unambiguously `object`. A class with any base list is skipped: from syntax
 * alone we cannot tell an interface (`: IFoo`, base is still object) from a real
 * base class (`: Foo`, where base.Equals may be a meaningful override), and
 * flagging the interface case would risk a false positive on the base-class
 * case. The no-base form covers the common mistake without that ambiguity.
 */
function derivesDirectlyFromObject(cls: SyntaxNode): boolean {
  return !cls.namedChildren.some((c) => c?.type === 'base_list')
}

/**
 * `base.GetHashCode()` / `base.Equals(...)` in a type that derives directly
 * from `object`. The object implementation is reference identity, which is
 * almost never what an overridden GetHashCode/Equals wants to delegate to —
 * it defeats the value semantics the override is trying to provide.
 */
export const csharpBaseCallOnObjectVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/base-call-on-object',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.child(0)?.type !== 'base') return null
    const member = node.childForFieldName('name')?.text
    if (!member || !OBJECT_MEMBERS.has(member)) return null

    const cls = enclosingClass(node)
    if (!cls || !derivesDirectlyFromObject(cls)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `base.${member} in a type deriving from object`,
      `\`base.${member}\` here calls object's reference-identity implementation, which is almost never what an override wants.`,
      sourceCode,
      `Remove the base call — compute ${member} from this type's own fields instead.`,
    )
  },
}
