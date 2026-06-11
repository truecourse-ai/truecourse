import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

const STRING_LITERAL_TYPES = new Set(['string_literal', 'verbatim_string_literal', 'raw_string_literal'])

function isPlusExpression(n: SyntaxNode | null): boolean {
  return n?.type === 'binary_expression' && n.childForFieldName('operator')?.text === '+'
}

function flattenConcat(n: SyntaxNode, acc: SyntaxNode[]): void {
  if (isPlusExpression(n)) {
    const left = n.childForFieldName('left')
    const right = n.childForFieldName('right')
    if (left) flattenConcat(left, acc)
    if (right) acc.push(right)
    return
  }
  acc.push(n)
}

/**
 * 3+-segment `+` concatenation mixing string literals and values — an
 * interpolated string reads better. Const contexts are excluded:
 * interpolation is not a compile-time constant for non-string operands
 * (const fields/locals, attribute arguments, parameter defaults, case labels).
 */
export const csharpPreferTemplateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-template',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '+') return null
    // Only the top of the concatenation chain reports.
    if (isPlusExpression(node.parent)) return null

    const operands: SyntaxNode[] = []
    flattenConcat(node, operands)
    if (operands.length < 3) return null

    const literals = operands.filter((o) => STRING_LITERAL_TYPES.has(o.type))
    if (literals.length === 0) return null
    if (literals.length === operands.length) return null // pure literal concat → useless-concat's turf

    // The chain must actually be string concatenation: arithmetic chains
    // (`a + b + 1`) contain no string literal and were rejected above.

    // Skip const / attribute / default-value / case-label contexts.
    let current = node.parent
    while (current) {
      const t = current.type
      if (t === 'attribute' || t === 'attribute_argument' || t === 'enum_member_declaration'
        || t === 'parameter' || t === 'constant_pattern' || t === 'case_switch_label') return null
      if (t === 'local_declaration_statement' && current.children.some((c) => c?.type === 'const')) return null
      if (t === 'field_declaration' && hasCSharpModifier(current, 'const')) return null
      if (t === 'block' || t === 'declaration_list' || t === 'arrow_expression_clause') break
      current = current.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'String concatenation chain',
      `${operands.length}-segment \`+\` concatenation of strings and values — an interpolated string ($"…") reads better.`,
      sourceCode,
      'Replace the concatenation with an interpolated string: `$"text {expr} more"`.',
    )
  },
}
