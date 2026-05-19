import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const computedEnumValueVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/computed-enum-value',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['enum_assignment'],
  visit(node, filePath, sourceCode) {
    // tree-sitter exposes the RHS via the `value` field — `namedChildren[0]`
    // was returning the LHS `property_identifier` (the enum member name), so
    // string-literal initializers like `FREE = 'free'` were being misclassified
    // as non-literal "computed" values.
    const value = node.childForFieldName('value')
    if (!value) return null

    if (value.type === 'string' || value.type === 'number') return null
    if (value.type === 'unary_expression') {
      const op = value.children[0]
      const operand = value.namedChildren[0]
      if (op?.text === '-' && operand?.type === 'number') return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Computed enum member value',
      'Enum members should have literal values. Computed values can cause unexpected behavior.',
      sourceCode,
      'Replace the computed expression with a literal constant.',
    )
  },
}
