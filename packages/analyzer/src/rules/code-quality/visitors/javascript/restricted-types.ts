import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects usage of restricted TypeScript types.
 * Flags types like Object, String, Number, Boolean, Function, Symbol
 * which are wrapper types and should use lowercase equivalents.
 */
const RESTRICTED_TYPES = new Map<string, string>([
  ['Object', 'Use object or Record<string, unknown> instead of Object'],
  ['String', 'Use string instead of String wrapper type'],
  ['Number', 'Use number instead of Number wrapper type'],
  ['Boolean', 'Use boolean instead of Boolean wrapper type'],
  ['Symbol', 'Use symbol instead of Symbol wrapper type'],
  ['BigInt', 'Use bigint instead of BigInt wrapper type'],
  ['Function', 'Use specific function type signature instead of Function'],
  ['{}', 'Use Record<string, unknown> or object instead of empty object type'],
])

export const restrictedTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/restricted-types',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_identifier'],
  visit(node, filePath, sourceCode) {
    const reason = RESTRICTED_TYPES.get(node.text)
    if (!reason) return null

    // Only flag in type annotation contexts
    const parent = node.parent
    if (!parent) return null

    // Check if this is in a type context
    if (
      parent.type !== 'type_annotation' &&
      parent.type !== 'type_alias_declaration' &&
      parent.type !== 'generic_type' &&
      parent.type !== 'union_type' &&
      parent.type !== 'intersection_type' &&
      parent.type !== 'constraint' &&
      parent.type !== 'extends_clause' &&
      parent.type !== 'implements_clause'
    ) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Restricted type usage',
      `${reason}.`,
      sourceCode,
      'Use the recommended type alternative.',
    )
  },
}
