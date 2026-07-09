import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * A generic method type parameter that appears in no ordinary parameter type
 * cannot be inferred at the call site, so every caller must spell it out
 * explicitly (`Make<Order>()`). The check fires on a `method_declaration` with a
 * `type_parameter_list` where some type parameter is used **in the return type**
 * but by no `parameter` type — a method that *produces* a `T`-typed value the
 * caller must annotate.
 *
 * Two shapes are deliberately not flagged:
 *   - A type parameter used only in the method *body* (never in a parameter or
 *     the return type) is the idiomatic type-token / type-keyed pattern —
 *     `GetService<T>()`, `services.AddSingleton<T>()`, `Enable<T>()`,
 *     `TryAddObjectAccessor<T>()` — where the caller specifying `T` *is* the
 *     intended design, not an inference defect. (Used *nowhere at all* is
 *     `unused-type-parameter`'s job, not this rule's.)
 *   - A method declared on an *interface* mirrors a contract whose signature the
 *     author does not control (`IEfCoreDbContext.Set<TEntity>(string)`), so a
 *     non-inferable type parameter there is the contract's shape, not a defect.
 */
const TYPE_DECL_TYPES = new Set([
  'interface_declaration', 'class_declaration', 'struct_declaration',
  'record_declaration', 'record_struct_declaration',
])

function isInterfaceMember(method: SyntaxNode): boolean {
  let current = method.parent
  while (current) {
    if (TYPE_DECL_TYPES.has(current.type)) return current.type === 'interface_declaration'
    current = current.parent
  }
  return false
}
function identifiersIn(node: SyntaxNode | null): Set<string> {
  const used = new Set<string>()
  if (!node) return used
  walkCSharp(node, (n) => {
    if (n.type === 'identifier') used.add(n.text)
  })
  return used
}

function parameterTypeIdentifiers(method: SyntaxNode): Set<string> {
  const used = new Set<string>()
  const params = method.childForFieldName('parameters')
  if (!params) return used
  for (const param of params.namedChildren) {
    if (param?.type !== 'parameter') continue
    for (const id of identifiersIn(param.childForFieldName('type'))) used.add(id)
  }
  // A trailing `params T[]` parameter is not wrapped in a `parameter` node by
  // tree-sitter-c-sharp; its type is attached directly as the `type` field of
  // the parameter list. Fold those identifiers in so `T` still counts as used.
  for (const id of identifiersIn(params.childForFieldName('type'))) used.add(id)
  return used
}

export const csharpGenericParameterNotInferableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/generic-parameter-not-inferable',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const typeParams = node.namedChildren.find((c) => c?.type === 'type_parameter_list')
    if (!typeParams) return null
    // An interface method's signature is the contract, not the author's to change.
    if (isInterfaceMember(node)) return null

    const usedInParams = parameterTypeIdentifiers(node)
    // The return type is the type node preceding the `name` field (no field of
    // its own in this grammar). Collect identifiers from everything before the
    // name that is a type position.
    const nameNode = node.childForFieldName('name')
    const usedInReturn = new Set<string>()
    for (const child of node.namedChildren) {
      if (!child || (nameNode && child.startIndex >= nameNode.startIndex)) break
      if (child.type === 'modifier' || child.type === 'attribute_list') continue
      for (const id of identifiersIn(child)) usedInReturn.add(id)
    }

    for (const tp of typeParams.namedChildren) {
      if (tp?.type !== 'type_parameter') continue
      const name = tp.namedChildren.find((c) => c?.type === 'identifier')?.text
      if (!name) continue
      // Fire only when the parameter is produced in the return type. Body-only
      // uses are the type-token idiom (not an inference defect); no use at all
      // is unused-type-parameter's concern.
      if (!usedInParams.has(name) && usedInReturn.has(name)) {
        return makeViolation(
          this.ruleKey, tp, filePath, 'low',
          'Type parameter not inferable',
          `Type parameter \`${name}\` appears in no method parameter, so callers must always specify it explicitly.`,
          sourceCode,
          `Use \`${name}\` in a parameter type, or accept that callers must specify it and consider a non-generic design.`,
        )
      }
    }
    return null
  },
}
