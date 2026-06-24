import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { lastSegment } from './_helpers.js'

/**
 * A `public static` field whose type is a mutable array or collection. Even
 * when `readonly`, the reference is fixed but the contents are not — any caller
 * can rewrite elements of the shared array/list, a shared-state and security
 * hazard. `const` fields and immutable types are not flagged.
 */
const MUTABLE_COLLECTION_TYPES = new Set([
  'List', 'Dictionary', 'HashSet', 'SortedList', 'SortedDictionary', 'SortedSet',
  'Collection', 'ObservableCollection', 'Queue', 'Stack', 'LinkedList',
  'ArrayList', 'Hashtable', 'SortedSet', 'StringBuilder',
])

function fieldType(field: SyntaxNode): SyntaxNode | null {
  const decl = field.namedChildren.find((c) => c?.type === 'variable_declaration')
  return decl?.namedChildren.find((c) => c?.type !== 'variable_declarator') ?? null
}

function isMutableType(type: SyntaxNode | null): boolean {
  if (!type) return false
  if (type.type === 'array_type') return true
  if (type.type === 'generic_name') {
    const name = type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    return MUTABLE_COLLECTION_TYPES.has(name)
  }
  if (type.type === 'qualified_name') {
    const last = type.namedChildren[type.namedChildren.length - 1]
    if (last?.type === 'generic_name') {
      return MUTABLE_COLLECTION_TYPES.has(last.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
    }
    return MUTABLE_COLLECTION_TYPES.has(lastSegment(type.text))
  }
  return false
}

export const csharpMutablePublicStaticFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mutable-public-static-field',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public') || !hasCSharpModifier(node, 'static')) return null
    if (hasCSharpModifier(node, 'const')) return null
    if (!isMutableType(fieldType(node))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Mutable public static field',
      'A public static array or collection is shared mutable state — any caller can tamper with its contents even when the field is readonly.',
      sourceCode,
      'Return a copy from a method, or expose a read-only view (ReadOnlyCollection / ImmutableArray).',
    )
  },
}
