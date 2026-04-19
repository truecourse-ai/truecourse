import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const duplicateEnumValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-enum-value',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const seen = new Map<string, SyntaxNode>()

    for (const member of body.namedChildren) {
      if (member.type === 'property_identifier' || member.type === 'enum_assignment') {
        const value = member.type === 'enum_assignment' ? member.childForFieldName('value') : null
        if (value) {
          const valueText = value.text
          if (seen.has(valueText)) {
            return makeViolation(
              this.ruleKey, member, filePath, 'high',
              'Duplicate enum value',
              `Enum value \`${valueText}\` is already used — this member is unreachable by value.`,
              sourceCode,
              'Use a unique value for each enum member.',
            )
          }
          seen.set(valueText, member)
        }
      }
    }
    return null
  },
}
