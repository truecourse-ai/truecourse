import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An enum member named `Reserved` (or `Reserved1`, `Reserved2`, …) is a
 * placeholder for future values. It carries no meaning at the call site and, in
 * a shipped enum, becomes a permanent name that can never be repurposed without
 * a breaking change. Reserve room by leaving gaps in the numeric values
 * instead, not by naming a member `Reserved`.
 */
const RESERVED = /^Reserved\d*$/

export const csharpEnumReservedMemberNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/enum-reserved-member-name',
  languages: ['csharp'],
  nodeTypes: ['enum_member_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
      ?? node.namedChildren.find((c) => c?.type === 'identifier')?.text
    if (!name || !RESERVED.test(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Enum member named Reserved',
      `Enum member \`${name}\` is a placeholder that should not ship; reserve future values by leaving gaps in the numeric values instead.`,
      sourceCode,
      'Remove the `Reserved` member, or give it a meaningful name if it represents a real value.',
    )
  },
}
