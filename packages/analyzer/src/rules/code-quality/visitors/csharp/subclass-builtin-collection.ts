import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

const BUILTIN_COLLECTIONS: Record<string, string> = {
  List: 'Collection<T>',
  Dictionary: 'KeyedCollection<TKey, TItem>',
}

/**
 * Public `class X : List<T>` / `: Dictionary<K,V>` — these concrete
 * collections expose no virtual mutation hooks, so the subclass cannot
 * enforce invariants when callers Add/Remove through the base API (CA1002:
 * prefer Collection<T>/KeyedCollection, or composition).
 */
export const csharpSubclassBuiltinCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/subclass-builtin-collection',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    // CA1002 targets externally visible types; internal helpers may subclass deliberately.
    if (!hasCSharpModifier(node, 'public')) return null

    const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
    if (!baseList) return null
    // The base CLASS is the first entry (interfaces follow).
    const base = baseList.namedChildren[0]
    if (base?.type !== 'generic_name') return null
    const baseName = base.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    const replacement = BUILTIN_COLLECTIONS[baseName]
    if (!replacement) return null

    const name = node.childForFieldName('name')?.text ?? 'class'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `Subclassing ${baseName}<>`,
      `\`${name}\` inherits \`${base.text}\` — its mutation methods are non-virtual, so the subclass cannot guard its own invariants (CA1002). Use \`${replacement}\` or composition.`,
      sourceCode,
      `Derive from \`${replacement}\` (which exposes protected mutation hooks), or wrap the collection as a private field.`,
    )
  },
}
