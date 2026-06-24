import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * A generic method type parameter that appears in no ordinary parameter type
 * cannot be inferred at the call site, so every caller must spell it out
 * explicitly (`Make<Order>()`). The check fires on a `method_declaration` with a
 * `type_parameter_list` where some type parameter is used by no `parameter`
 * type. Return type / body uses do not enable inference, so they do not count.
 *
 * A parameter used *nowhere* (not even the return type or body) is a different
 * smell — `unused-type-parameter` — so it is excluded here to avoid
 * double-reporting.
 */
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
  return used
}

export const csharpGenericParameterNotInferableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/generic-parameter-not-inferable',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const typeParams = node.namedChildren.find((c) => c?.type === 'type_parameter_list')
    if (!typeParams) return null

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
    const usedInBody = identifiersIn(node.childForFieldName('body'))

    for (const tp of typeParams.namedChildren) {
      if (tp?.type !== 'type_parameter') continue
      const name = tp.namedChildren.find((c) => c?.type === 'identifier')?.text
      if (!name) continue
      // Skip params used nowhere (unused-type-parameter owns those).
      const usedElsewhere = usedInReturn.has(name) || usedInBody.has(name)
      if (!usedInParams.has(name) && usedElsewhere) {
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
