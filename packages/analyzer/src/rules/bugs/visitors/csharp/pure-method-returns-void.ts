import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Right-most simple name of an attribute's identifier/qualified name. */
function attributeName(attr: SyntaxNode): string {
  const name = attr.childForFieldName('name') ?? attr.namedChildren[0]
  if (!name) return ''
  const text = name.text
  return text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
}

/**
 * A method annotated `[Pure]` that returns `void`. A pure method has no
 * side effects, so its only observable result is its return value — a pure
 * method that returns nothing does nothing observable and is meaningless. The
 * `[Pure]` contract was almost certainly applied to the wrong member or the
 * method actually has side effects the attribute denies.
 */
export const csharpPureMethodReturnsVoidVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/pure-method-returns-void',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const pureAttr = node.children.find(
      (c) =>
        c?.type === 'attribute_list' &&
        c.namedChildren.some(
          (a) =>
            a?.type === 'attribute' &&
            (attributeName(a) === 'Pure' || attributeName(a) === 'PureAttribute'),
        ),
    )
    if (!pureAttr) return null

    const returnType = node.childForFieldName('returns')
    if (!(returnType?.type === 'predefined_type' && returnType.text === 'void')) return null

    const methodName = node.childForFieldName('name')?.text
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '[Pure] method returns void',
      `\`${methodName ?? '?'}\` is marked \`[Pure]\` but returns \`void\`. A pure method's only observable effect is its return value, so a void pure method does nothing observable.`,
      sourceCode,
      'Return the computed value, or remove `[Pure]` if the method legitimately mutates state.',
    )
  },
}
