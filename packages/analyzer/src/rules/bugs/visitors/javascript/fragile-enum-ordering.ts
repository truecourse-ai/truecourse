import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: enum members without explicit initializers
// This makes the enum fragile because adding/removing members changes values
export const fragileEnumOrderingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fragile-enum-ordering',
  languages: JS_LANGUAGES,
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'enum_body')
    if (!body) return null

    // Only flag numeric enums (no string initializers) with more than one member
    const members = body.namedChildren.filter((c) =>
      c.type === 'property_identifier' || c.type === 'enum_assignment'
    )

    if (members.length <= 1) return null

    const membersWithoutInitializer = members.filter((m) => m.type === 'property_identifier')
    const membersWithStringInit = members.filter((m) => {
      if (m.type !== 'enum_assignment') return false
      const value = m.namedChildren.find((c) => c.type !== 'property_identifier')
      return value?.type === 'string'
    })

    // Skip if all members have string initializers (string enums are fine)
    if (membersWithStringInit.length === members.length) return null

    // Flag numeric enums with some members lacking initializers
    if (membersWithoutInitializer.length > 0) {
      const enumName = node.namedChildren.find((c) => c.type === 'identifier')?.text ?? 'enum'
      const firstUninitialized = membersWithoutInitializer[0]

      return makeViolation(
        this.ruleKey, firstUninitialized, filePath, 'medium',
        'Enum member without explicit initializer',
        `Enum \`${enumName}\` member \`${firstUninitialized.text}\` has no explicit initializer — reordering members changes their numeric values, making this fragile.`,
        sourceCode,
        'Add explicit numeric initializers to all enum members to make them stable.',
      )
    }

    return null
  },
}
