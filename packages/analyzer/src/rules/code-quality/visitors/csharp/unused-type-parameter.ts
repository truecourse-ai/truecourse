import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * A generic type parameter that is referenced nowhere in the member's signature
 * or body is dead: it adds an arity callers must satisfy but constrains nothing.
 * The check fires on a `method_declaration` whose `type_parameter_list` has a
 * parameter that appears in no other identifier across the whole declaration.
 *
 * Generic *type* declarations (`class Foo<T>`) are excluded: an unused type
 * parameter on a type is frequently a phantom/marker type used only at the
 * call site (`IRequest<TResponse>`), which is legitimate and would be a false
 * positive.
 */
function declaredTypeParams(list: SyntaxNode): { name: string; node: SyntaxNode }[] {
  const out: { name: string; node: SyntaxNode }[] = []
  for (const tp of list.namedChildren) {
    if (tp?.type !== 'type_parameter') continue
    const name = tp.namedChildren.find((c) => c?.type === 'identifier')?.text
    if (name) out.push({ name, node: tp })
  }
  return out
}

export const csharpUnusedTypeParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-type-parameter',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement'],
  visit(node, filePath, sourceCode) {
    const list = node.namedChildren.find((c) => c?.type === 'type_parameter_list')
    if (!list) return null

    const params = declaredTypeParams(list)
    if (params.length === 0) return null

    // Count identifier occurrences outside the type_parameter_list declaration.
    const usage = new Map<string, number>()
    walkCSharp(node, (n) => {
      if (n.type !== 'identifier') return
      // Skip the declaration site itself (the type_parameter_list).
      let p: SyntaxNode | null = n
      while (p && p.id !== node.id) {
        if (p.id === list.id) return
        p = p.parent
      }
      usage.set(n.text, (usage.get(n.text) ?? 0) + 1)
    })

    for (const { name, node: tpNode } of params) {
      if (!usage.get(name)) {
        return makeViolation(
          this.ruleKey, tpNode, filePath, 'low',
          'Unused type parameter',
          `Type parameter \`${name}\` is never used in the method signature or body.`,
          sourceCode,
          `Remove the unused type parameter \`${name}\`.`,
        )
      }
    }
    return null
  },
}
