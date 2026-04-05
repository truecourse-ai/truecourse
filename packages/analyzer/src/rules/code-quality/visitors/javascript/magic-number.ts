import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { MAGIC_NUMBER_WHITELIST } from './_helpers.js'

export const magicNumberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-number',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const val = parseFloat(node.text)
    if (Number.isNaN(val)) return null
    if (MAGIC_NUMBER_WHITELIST.has(val)) return null

    // Only flag integers and simple decimals > 2
    if (!Number.isFinite(val)) return null

    const parent = node.parent
    if (!parent) return null

    // Skip: enum values, type annotations, array indices, object property values with meaningful context
    // Flag when used as: argument to function call, binary expression operand (not array index)
    const parentType = parent.type

    // Skip declarations of constants (e.g., const MAX = 100)
    if (parentType === 'variable_declarator') return null
    // Skip enum member
    if (parentType === 'enum_assignment') return null
    // Skip default parameter value
    if (parentType === 'assignment_pattern' || parentType === 'assignment_expression') return null
    // Skip return statements (too many false positives)
    if (parentType === 'return_statement') return null
    // Skip object properties (too noisy)
    if (parentType === 'pair') return null
    // Only flag in binary expressions and function arguments
    if (parentType !== 'binary_expression' && parentType !== 'arguments') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Magic number: ${node.text}`,
      `Numeric literal \`${node.text}\` has no explanation. Extract it to a named constant for clarity.`,
      sourceCode,
      `Extract \`${node.text}\` to a named constant: \`const THRESHOLD = ${node.text};\``,
    )
  },
}
