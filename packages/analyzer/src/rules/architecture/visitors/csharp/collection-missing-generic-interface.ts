import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type that implements a non-generic collection interface (IEnumerable,
 * ICollection, IList) but not its generic counterpart forces consumers through
 * the untyped, boxing API. Implement the generic interface as well.
 *
 * Purely structural — the base list names the interfaces directly, so this
 * needs no type resolution. We only fire when the generic form of the *same*
 * interface is absent from the base list.
 */
const NON_GENERIC_COLLECTION_INTERFACES = new Set(['IEnumerable', 'ICollection', 'IList'])

function baseSimpleName(base: SyntaxNode): { name: string; isGeneric: boolean } | null {
  if (base.type === 'generic_name') {
    const id = base.namedChildren.find((c) => c?.type === 'identifier')?.text
    return id ? { name: id, isGeneric: true } : null
  }
  if (base.type === 'identifier') return { name: base.text, isGeneric: false }
  if (base.type === 'qualified_name') {
    const simple = base.text.split('.').pop() ?? base.text
    return { name: simple, isGeneric: false }
  }
  return null
}

export const csharpCollectionMissingGenericInterfaceVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/collection-missing-generic-interface',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
    if (!baseList) return null

    const nonGeneric: { simple: string; baseNode: SyntaxNode } = { simple: '', baseNode: node }
    const genericNames = new Set<string>()
    let found: SyntaxNode | null = null

    for (const base of baseList.namedChildren) {
      if (!base) continue
      const info = baseSimpleName(base)
      if (!info) continue
      if (info.isGeneric) {
        genericNames.add(info.name)
      } else if (NON_GENERIC_COLLECTION_INTERFACES.has(info.name) && !found) {
        nonGeneric.simple = info.name
        nonGeneric.baseNode = base
        found = base
      }
    }
    if (!found) return null
    // Already implements the generic counterpart of the same interface.
    if (genericNames.has(nonGeneric.simple)) return null

    const typeName = node.childForFieldName('name')?.text ?? 'type'
    return makeViolation(
      this.ruleKey, found, filePath, 'low',
      'Collection lacks generic interface',
      `'${typeName}' implements ${nonGeneric.simple} but not ${nonGeneric.simple}<T>, limiting how it can be consumed.`,
      sourceCode,
      `Also implement ${nonGeneric.simple}<T> so consumers get a strongly typed, non-boxing API.`,
    )
  },
}
