import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An enum member whose name repeats the enum type name as a prefix
 * (`enum Color { ColorRed }`) is redundant: callers already write
 * `Color.Red`, so the `Color` prefix duplicates context the type supplies.
 * The rule fires only when stripping the prefix leaves a valid PascalCase
 * identifier, so a member that merely happens to start with the type name as
 * one word (e.g. `Colorful`) is not flagged.
 */
export const csharpEnumMemberPrefixedWithTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/enum-member-prefixed-with-type',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    const enumName = node.childForFieldName('name')?.text
    if (!enumName) return null
    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'enum_member_declaration_list')
    if (!body) return null

    for (const member of body.namedChildren) {
      if (member?.type !== 'enum_member_declaration') continue
      const memberName = member.childForFieldName('name')?.text
        ?? member.namedChildren.find((c) => c?.type === 'identifier')?.text
      if (!memberName) continue
      if (!memberName.startsWith(enumName)) continue
      const remainder = memberName.slice(enumName.length)
      // Require the remainder to begin a new PascalCase word so `Colorful`
      // (no word boundary) doesn't trip on `Color`.
      if (!/^[A-Z][A-Za-z0-9]*$/.test(remainder)) continue

      return makeViolation(
        this.ruleKey, member, filePath, 'low',
        'Enum member prefixed with type name',
        `Enum member \`${memberName}\` repeats the enum name \`${enumName}\` as a prefix; callers already qualify it as \`${enumName}.${memberName}\`.`,
        sourceCode,
        `Rename the member to \`${remainder}\` and drop the redundant \`${enumName}\` prefix.`,
      )
    }
    return null
  },
}
