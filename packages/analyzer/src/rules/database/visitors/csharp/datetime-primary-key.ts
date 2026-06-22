import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * A primary key keyed on a temporal value (`DateTime` / `DateTimeOffset` /
 * `DateOnly` / `TimeOnly`) is a poor key: two rows created in the same tick
 * collide, clock skew and DST transitions reorder inserts, and the key leaks a
 * business fact (when the row was made) into every foreign-key reference.
 *
 * The primary key is identified by EF Core's own discovery rules, both of which
 * are syntactically visible on the property:
 *   - an explicit `[Key]` attribute, or
 *   - the by-convention name `Id` or `<ClassName>Id`.
 *
 * The property's declared type is read straight off the AST — no type inference,
 * so an aliased `using D = System.DateTime;` is out of scope (the alias hides
 * the temporal type).
 */

const TEMPORAL_TYPES = new Set(['DateTime', 'DateTimeOffset', 'DateOnly', 'TimeOnly'])

/** Simple temporal type name for a property's type node, or null. */
function temporalTypeName(typeNode: SyntaxNode | null): string | null {
  if (!typeNode) return null
  // `DateTime?` — unwrap to the underlying type.
  let node = typeNode
  if (node.type === 'nullable_type') {
    const inner = node.namedChildren.find(Boolean)
    if (!inner) return null
    node = inner
  }
  // `System.DateTime` / `DateTime` — the simple name is the trailing identifier.
  if (node.type === 'qualified_name') {
    const last = node.childForFieldName('name')?.text ?? node.namedChildren.at(-1)?.text
    return last && TEMPORAL_TYPES.has(last) ? last : null
  }
  if (node.type === 'identifier') {
    return TEMPORAL_TYPES.has(node.text) ? node.text : null
  }
  return null
}

/** Name of the type/struct/record/interface that declares `property`, or null. */
function declaringTypeName(property: SyntaxNode): string | null {
  let current: SyntaxNode | null = property.parent
  while (current) {
    if (
      current.type === 'class_declaration' ||
      current.type === 'record_declaration' ||
      current.type === 'struct_declaration'
    ) {
      return current.childForFieldName('name')?.text ?? null
    }
    current = current.parent
  }
  return null
}

/**
 * True when `property` is the type's primary key under EF Core's discovery
 * rules: an explicit `[Key]` attribute, or the by-convention name `Id` /
 * `<ClassName>Id` (the convention is case-sensitive in EF Core).
 */
function isPrimaryKey(property: SyntaxNode, propertyName: string): boolean {
  if (getCSharpAttributeNames(property).includes('Key')) return true
  if (propertyName === 'Id') return true
  const typeName = declaringTypeName(property)
  return typeName !== null && propertyName === `${typeName}Id`
}

export const csharpDatetimePrimaryKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/datetime-primary-key',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const temporal = temporalTypeName(node.childForFieldName('type'))
    if (!temporal) return null

    const propertyName = node.childForFieldName('name')?.text
    if (!propertyName) return null

    if (!isPrimaryKey(node, propertyName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'DateTime used as a primary key',
      `Primary key "${propertyName}" is a ${temporal}. Temporal primary keys collide when rows share a tick, reorder under clock skew, and leak creation time into every foreign key.`,
      sourceCode,
      'Use a surrogate key (an auto-increment integer or a GUID) and keep the timestamp as an ordinary column.',
    )
  },
}
