import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A <c>[JSInvokable]</c> method that is not <c>public</c>. Blazor's JavaScript interop
 * reaches managed methods by reflection over the public surface; a private, internal or
 * protected <c>[JSInvokable]</c> method is invisible to <c>DotNet.invokeMethod</c> and
 * throws at runtime when JavaScript tries to call it. Matched by attribute name, so no
 * Blazor reference assemblies are needed; interface members (implicitly public) are out
 * of scope.
 */
export const csharpJsInvokableNonPublicVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/jsinvokable-non-public',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!attributeNames(node).includes('JSInvokable')) return null
    const modifiers = node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    if (modifiers.includes('public')) return null
    if (node.parent?.parent?.type === 'interface_declaration') return null

    const name = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, name ?? node, filePath, 'medium',
      '[JSInvokable] method is not public',
      `'${name?.text ?? ''}' is marked [JSInvokable] but is not public, so JavaScript interop cannot reach it and the call fails at runtime.`,
      sourceCode,
      'Make the [JSInvokable] method public.',
    )
  },
}

/** Attribute names (last segment, `Attribute` suffix stripped) applied to a declaration. */
function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push((n.split('.').pop() ?? n).replace(/Attribute$/, ''))
    }
  }
  return names
}
