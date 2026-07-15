import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * True when `name` matches a generic type parameter declared on any enclosing
 * method, local function, or type declaration — e.g. `TPart` in
 * `TResult Foo<TPart>()`. For such a parameter `nameof(TPart)` is the literal
 * string "TPart", not the runtime type-argument name that `typeof(TPart).Name`
 * returns, so the two are not interchangeable and the rule must not fire.
 */
function isGenericTypeParameterInScope(node: SyntaxNode, name: string): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    for (const child of cur.namedChildren) {
      if (child?.type !== 'type_parameter_list') continue
      for (const tp of child.namedChildren) {
        if (tp?.type !== 'type_parameter') continue
        const tpName = tp.childForFieldName('name')?.text
          ?? tp.namedChildren.find((c) => c?.type === 'identifier')?.text
        if (tpName === name) return true
      }
    }
    cur = cur.parent
  }
  return false
}

/**
 * `typeof(X).Name` performs a runtime reflection lookup to recover a name the
 * compiler already knows; `nameof(X)` yields the same string as a compile-time
 * constant and survives a rename (IDE0082). The check targets a
 * `member_access_expression` whose receiver is a `typeof_expression` and whose
 * member is exactly `Name`.
 *
 * `FullName`, `AssemblyQualifiedName`, etc. are intentionally not matched —
 * only `.Name` has a `nameof` equivalent.
 */

export const csharpTypeofNameOverTypeofNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/typeof-name-over-typeof-name',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'Name') return null
    const receiver = node.childForFieldName('expression')
    if (receiver?.type !== 'typeof_expression') return null

    const typeArg = receiver.namedChildren.find(Boolean)?.text ?? 'X'
    // `nameof(T)` on a generic type parameter yields the literal parameter name
    // ("T"), not the runtime type argument's name, so it is not equivalent to
    // `typeof(T).Name`. Suggesting the swap there would be wrong.
    if (isGenericTypeParameterInScope(node, typeArg)) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Convert typeof().Name to nameof',
      `\`typeof(${typeArg}).Name\` is a runtime reflection lookup; \`nameof(${typeArg})\` produces the same string at compile time and survives renames (IDE0082).`,
      sourceCode,
      `Replace \`typeof(${typeArg}).Name\` with \`nameof(${typeArg})\`.`,
    )
  },
}
