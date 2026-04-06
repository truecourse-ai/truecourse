import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: TypeScript enums that mix number and string members
// e.g., enum Foo { A = 1, B = "b" }
export const mixedEnumValuesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mixed-enum-values',
  languages: JS_LANGUAGES,
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'enum_body')
    if (!body) return null

    let hasNumber = false
    let hasString = false

    for (const member of body.namedChildren) {
      if (member.type !== 'property_identifier' && member.type !== 'enum_assignment') continue

      if (member.type === 'enum_assignment') {
        const value = member.namedChildren.find((c) => c.type !== 'property_identifier')
        if (!value) continue

        if (value.type === 'number') hasNumber = true
        if (value.type === 'string') hasString = true
        if (value.type === 'unary_expression') {
          // -1 type expressions
          const operand = value.namedChildren[0]
          if (operand?.type === 'number') hasNumber = true
        }
      }
      // Auto-incremented numeric members (no initializer) count as numbers
      if (member.type === 'property_identifier') {
        hasNumber = true
      }
    }

    if (hasNumber && hasString) {
      const enumName = node.namedChildren.find((c) => c.type === 'identifier')?.text ?? 'enum'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Mixed enum members',
        `Enum \`${enumName}\` has both number and string members — mixed enums are confusing and can cause unexpected behavior.`,
        sourceCode,
        'Use either all string or all number values for consistency.',
      )
    }

    return null
  },
}
