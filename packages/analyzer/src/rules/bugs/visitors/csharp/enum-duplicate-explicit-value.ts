import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Whether the enum carries [Flags], where shared values are sometimes intentional aliases. */
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
 * Two or more enum members assigned the same explicit integer literal, e.g.
 * `enum E { A = 1, B = 2, C = 1 }`. This is almost always a copy-paste mistake:
 * `C` is silently an alias for `A`, so `switch`/comparison logic that expects
 * them to be distinct breaks. Only plain integer literals are compared, so
 * deliberate symbolic aliases (`Default = Off`) and computed values are left
 * alone. [Flags] enums, where shared values can be intentional, are skipped.
 */
export const csharpEnumDuplicateExplicitValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/enum-duplicate-explicit-value',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    if (isFlagsEnum(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const seen = new Map<string, string>() // literal value -> first member name
    for (const member of body.namedChildren) {
      if (member?.type !== 'enum_member_declaration') continue
      const value = member.childForFieldName('value')
      if (value?.type !== 'integer_literal') continue
      const memberName = member.childForFieldName('name')?.text ?? '?'
      const literal = value.text.replace(/_/g, '')
      const prior = seen.get(literal)
      if (prior) {
        return makeViolation(
          this.ruleKey, member, filePath, 'medium',
          'Enum members share an explicit value',
          `\`${memberName}\` is assigned the same value (${value.text}) as \`${prior}\`, making it a silent alias — likely a copy-paste mistake.`,
          sourceCode,
          'Give each member a distinct value, or reference the other member by name if the alias is intentional.',
        )
      }
      seen.set(literal, memberName)
    }
    return null
  },
}
