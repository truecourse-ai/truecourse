import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** A `""` literal carrying no content (no characters, no escapes). */
function isEmptyStringLiteral(node: SyntaxNode): boolean {
  if (node.type !== 'string_literal') return false
  return !node.namedChildren.some(
    (c) => c?.type === 'string_literal_content' || c?.type === 'escape_sequence',
  )
}

/**
 * Contexts where `string.Empty` is the unambiguous improvement: a value being
 * assigned, returned, or used to initialize a member. A `""` passed as a call
 * argument (`Split("")`, `string.Join("", …)`) or compared (`x == ""`, owned
 * by `compare-to-empty-string`) is intentionally not flagged — those are
 * idiomatic and would be noise.
 */
function isFlaggableStringEmptyContext(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false
  switch (parent.type) {
    case 'return_statement':
    case 'arrow_expression_clause':
      return true
    case 'variable_declarator':
    case 'equals_value_clause':
      return true
    case 'assignment_expression':
      return parent.childForFieldName('operator')?.text === '='
    default:
      return false
  }
}

/**
 * An empty string literal `""` says nothing about intent; `string.Empty`
 * reads as a deliberate "no characters" rather than a literal that might have
 * lost its content in an edit (SA1122). Scoped to assignment / return /
 * initializer positions so it never collides with `compare-to-empty-string`
 * (the `==` operand) or flags idiomatic `""` call arguments.
 */
export const csharpPreferStringEmptyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-string-empty',
  languages: ['csharp'],
  nodeTypes: ['string_literal'],
  visit(node, filePath, sourceCode) {
    if (!isEmptyStringLiteral(node)) return null
    if (!isFlaggableStringEmptyContext(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer string.Empty over ""',
      'An empty string literal `""` is written where `string.Empty` more clearly conveys "no characters" and cannot be mistaken for a literal that lost its content (SA1122).',
      sourceCode,
      'Replace the `""` literal with `string.Empty`.',
    )
  },
}
