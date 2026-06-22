import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpDeclAttributeNames } from './_helpers.js'

/** Parse a simple integer literal value (handles a leading unary minus). */
function literalValue(node: SyntaxNode | null | undefined): number | null {
  if (!node) return null
  if (node.type === 'integer_literal') {
    const v = parseInt(node.text.replace(/_/g, '').replace(/[ul]+$/i, ''), node.text.toLowerCase().startsWith('0x') ? 16 : 10)
    return Number.isNaN(v) ? null : v
  }
  if (node.type === 'prefix_unary_expression' && node.children[0]?.text === '-') {
    const inner = literalValue(node.namedChildren.find((c) => c != null))
    return inner == null ? null : -inner
  }
  return null
}

/**
 * A non-`[Flags]` enum with no member valued zero leaves the default-
 * initialized value (`default(E)`, an uninitialized field) outside the set of
 * named members, so it never matches a case and prints as a bare number
 * (CA1008). Only fires when every member has an explicit non-zero initializer
 * — an enum whose first member is implicitly 0 already has a zero value.
 * `[Flags]` enums legitimately reserve 0 for "None" only by convention and
 * are out of scope here.
 */
export const csharpEnumMissingZeroValueVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/enum-missing-zero-value',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    if (getCSharpDeclAttributeNames(node).includes('Flags')) return null

    const body = node.namedChildren.find((c) => c?.type === 'enum_member_declaration_list')
    if (!body) return null
    const members = body.namedChildren.filter((c) => c?.type === 'enum_member_declaration')
    if (members.length === 0) return null

    // Every member must carry an explicit initializer; otherwise an implicit
    // 0 (or auto-incremented value reaching 0) may exist — bail to stay safe.
    let hasZero = false
    for (const member of members) {
      if (!member) return null
      const init = member.namedChildren.find((c) => c != null && c.type !== 'identifier')
      if (!init) return null // implicit value — cannot prove zero is missing
      const value = literalValue(init)
      if (value == null) return null // non-literal initializer — cannot evaluate
      if (value === 0) hasZero = true
    }
    if (hasZero) return null

    const name = node.childForFieldName('name')?.text ?? 'enum'
    return makeViolation(
      this.ruleKey, node.childForFieldName('name') ?? node, filePath, 'low',
      'Enum has no zero value',
      `Enum \`${name}\` defines no member valued 0, so its default-initialized value is not a named member (CA1008).`,
      sourceCode,
      'Add a member valued 0 (commonly `None = 0`) so the default value is named.',
    )
  },
}
