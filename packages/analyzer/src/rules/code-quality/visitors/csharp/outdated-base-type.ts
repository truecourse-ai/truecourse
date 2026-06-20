import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Deriving from a superseded base type carries forward its design flaws when a
 * modern replacement exists (S4052 / CA1058). The check fires on a
 * `class_declaration` whose base CLASS is one of the known legacy types:
 *   - `ApplicationException` — the original "derive your exceptions here"
 *     guidance was withdrawn; derive from `Exception`.
 *   - non-generic `CollectionBase` / `DictionaryBase` / `ReadOnlyCollectionBase`
 *     and `Hashtable`/`ArrayList` — superseded by `Collection<T>` and the
 *     generic collections.
 *
 * Generic `List<T>`/`Dictionary<K,V>` bases are owned by
 * `subclass-builtin-collection`, so they are not flagged here.
 */
const OUTDATED_BASES: Record<string, string> = {
  ApplicationException: 'Exception',
  CollectionBase: 'Collection<T>',
  DictionaryBase: 'KeyedCollection<TKey, TItem> or Dictionary<TKey, TValue>',
  ReadOnlyCollectionBase: 'ReadOnlyCollection<T>',
  Hashtable: 'Dictionary<TKey, TValue>',
  ArrayList: 'List<T>',
}

function baseClassName(node: SyntaxNode): { name: string; node: SyntaxNode } | null {
  const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return null
  const base = baseList.namedChildren[0]
  if (!base) return null
  // Plain identifier base type (interfaces and generic bases are other shapes).
  if (base.type !== 'identifier' && base.type !== 'qualified_name') return null
  const name = base.text.split('.').pop() ?? base.text
  return { name, node: base }
}

export const csharpOutdatedBaseTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/outdated-base-type',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const base = baseClassName(node)
    if (!base) return null
    const replacement = OUTDATED_BASES[base.name]
    if (!replacement) return null

    const name = node.childForFieldName('name')?.text ?? 'type'
    return makeViolation(
      this.ruleKey, base.node, filePath, 'low',
      'Outdated base type',
      `\`${name}\` derives from the superseded base type \`${base.name}\` — prefer \`${replacement}\`.`,
      sourceCode,
      `Derive \`${name}\` from \`${replacement}\` instead.`,
    )
  },
}
