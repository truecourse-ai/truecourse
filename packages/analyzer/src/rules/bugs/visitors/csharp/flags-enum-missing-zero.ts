import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Whether the enum carries the [Flags] attribute. */
function isFlagsEnum(enumDecl: SyntaxNode): boolean {
  for (const list of enumDecl.namedChildren) {
    if (list?.type !== 'attribute_list') continue
    for (const attr of list.namedChildren) {
      const name = attr?.type === 'attribute' ? (attr.childForFieldName('name')?.text ?? '') : ''
      const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
      if (last === 'Flags' || last === 'FlagsAttribute') return true
    }
  }
  return false
}

/**
 * A `[Flags]` enum with no member explicitly assigned `0`. Without a zero
 * member there is no name for the empty set, so `default(TEnum)`, a cleared
 * mask, and `HasFlag(none)` all map to an unnamed value, complicating bit math
 * and serialization. The conventional fix is a `None = 0` member.
 *
 * Only members with an explicit integer-literal `= 0` count as the zero value;
 * an enum relying on implicit positional values can't be judged here (the first
 * member would be 0, but that is a separate implicit-values concern), so this
 * rule only fires when at least one member has an explicit non-zero value and
 * none is explicitly 0.
 */
export const csharpFlagsEnumMissingZeroVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/flags-enum-missing-zero',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isFlagsEnum(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const members = body.namedChildren.filter((c) => c?.type === 'enum_member_declaration') as SyntaxNode[]
    if (members.length === 0) return null

    let hasExplicitValue = false
    for (const member of members) {
      const value = member.childForFieldName('value')
      if (value?.type !== 'integer_literal') {
        // A non-literal value (expression / implicit) means we cannot be sure
        // there is no zero — bail out to avoid a false positive.
        if (value) return null
        continue
      }
      hasExplicitValue = true
      if (value.text.replace(/_/g, '') === '0') return null
    }
    if (!hasExplicitValue) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Flags enum has no zero value',
      'This [Flags] enum declares no member equal to 0, so there is no name for the empty set — default values and cleared masks map to an unnamed value.',
      sourceCode,
      'Add a `None = 0` member to represent the empty combination.',
    )
  },
}
