import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `return (value);` / `throw (exception);` — the parentheses add nothing.
 * Only simple single-line operands are flagged; parentheses around compound
 * expressions (`return (a ?? b);`) can aid readability and are left alone.
 * Tuples (`return (a, b);`) parse as `tuple_expression`, casts as
 * `cast_expression` — neither reaches the parenthesized_expression check.
 */
const SIMPLE_OPERAND_TYPES = new Set([
  'identifier',
  'integer_literal',
  'real_literal',
  'string_literal',
  'verbatim_string_literal',
  'interpolated_string_expression',
  'character_literal',
  'boolean_literal',
  'null_literal',
  'invocation_expression',
  'member_access_expression',
  'element_access_expression',
  'object_creation_expression',
  'this_expression',
])

export const csharpUnnecessaryParenthesesStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/unnecessary-parentheses-style',
  languages: ['csharp'],
  nodeTypes: ['return_statement', 'throw_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'parenthesized_expression') return null

    // Multi-line parentheses are often deliberate formatting
    if (expr.startPosition.row !== expr.endPosition.row) return null

    const inner = expr.namedChildren[0]
    if (!inner || !SIMPLE_OPERAND_TYPES.has(inner.type)) return null

    const keyword = node.type === 'return_statement' ? 'return' : 'throw'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Unnecessary parentheses in ${keyword} statement`,
      `The parentheses around the ${keyword} value are not needed. Write \`${keyword} ${inner.text};\` instead of \`${keyword} (${inner.text});\`.`,
      sourceCode,
      `Remove the unnecessary parentheses: \`${keyword} ${inner.text};\`.`,
    )
  },
}
