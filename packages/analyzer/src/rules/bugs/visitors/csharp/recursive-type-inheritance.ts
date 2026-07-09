import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The simple (non-generic) name a base-list entry refers to, or null. */
function baseEntryName(entry: SyntaxNode): string | null {
  if (entry.type === 'identifier') return entry.text
  if (entry.type === 'generic_name') {
    return entry.namedChildren.find((c) => c?.type === 'identifier')?.text ?? null
  }
  if (entry.type === 'qualified_name') {
    return entry.childForFieldName('name')?.text ?? null
  }
  return null
}

/** Generic arity of a base-list entry (0 for a non-generic name). */
function baseEntryArity(entry: SyntaxNode): number {
  const generic = entry.type === 'generic_name'
    ? entry
    : entry.type === 'qualified_name'
      ? entry.childForFieldName('name')
      : null
  if (generic?.type !== 'generic_name') return 0
  const args = generic.namedChildren.find((c) => c?.type === 'type_argument_list')
  return args ? args.namedChildren.filter((c) => c != null).length : 0
}

/** Generic arity declared by the type itself (count of its type parameters). */
function declaredArity(node: SyntaxNode): number {
  const params = node.childForFieldName('type_parameters')
  if (!params) return 0
  return params.namedChildren.filter((c) => c?.type === 'type_parameter').length
}

/**
 * A type that lists itself in its own base list — `class Node : Node` or
 * `class C : Comparable<C>` written as a base class rather than an interface.
 * Direct self-inheritance is a compile error in well-formed code and signals a
 * copy-paste mistake; the recursive base list is nonsensical.
 *
 * Only the first base entry is a base *class* in C#; subsequent entries are
 * interfaces (where `IComparable<C>` self-reference is normal and correct), so
 * only the first entry is checked for a same-name self reference.
 */
export const csharpRecursiveTypeInheritanceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/recursive-type-inheritance',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'struct_declaration', 'record_declaration', 'interface_declaration'],
  visit(node, filePath, sourceCode) {
    const typeName = node.childForFieldName('name')?.text
    if (!typeName) return null

    const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
    if (!baseList) return null

    const firstBase = baseList.namedChildren.find(
      (c) => c?.type === 'identifier' || c?.type === 'generic_name' || c?.type === 'qualified_name',
    )
    if (!firstBase) return null

    // For interfaces every entry is a base interface; checking only the first
    // is still sound because a self-referential first interface is the bug.
    if (baseEntryName(firstBase) !== typeName) return null

    // A same-named base of a *different* generic arity is a distinct type, not a
    // self-reference: `IClient<T> : IClient` and
    // `IBasicRepository<TEntity, TKey> : IBasicRepository<TEntity>` are idiomatic
    // generic-extends-lower-arity pairings, not recursive inheritance. Only flag
    // when the base has the same arity as the declared type (true self-reference).
    if (baseEntryArity(firstBase) !== declaredArity(node)) return null

    return makeViolation(
      this.ruleKey, firstBase, filePath, 'high',
      'Recursive type inheritance',
      `\`${typeName}\` lists itself as its own base type, producing a nonsensical recursive inheritance chain.`,
      sourceCode,
      'Remove the self reference from the base list.',
    )
  },
}
