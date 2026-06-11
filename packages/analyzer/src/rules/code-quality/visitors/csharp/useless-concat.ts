import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const STRING_LITERAL_TYPES = new Set(['string_literal', 'verbatim_string_literal', 'raw_string_literal'])

function isPlus(n: SyntaxNode | null): boolean {
  return n?.type === 'binary_expression' && n.childForFieldName('operator')?.text === '+'
}

function allStringLiterals(n: SyntaxNode): boolean {
  if (STRING_LITERAL_TYPES.has(n.type)) return true
  if (isPlus(n)) {
    const left = n.childForFieldName('left')
    const right = n.childForFieldName('right')
    return !!left && !!right && allStringLiterals(left) && allStringLiterals(right)
  }
  return false
}

/**
 * Two adjacent string literals joined with `+` inside a mixed concatenation
 * — merge them into one literal. Chains made ENTIRELY of literals are a
 * line-wrapping formatting choice and are not flagged.
 */
export const csharpUselessConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-concat',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '+') return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null
    if (!STRING_LITERAL_TYPES.has(left.type) || !STRING_LITERAL_TYPES.has(right.type)) return null

    let root = node
    while (isPlus(root.parent)) root = root.parent!
    if (allStringLiterals(root)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless string concatenation',
      `Concatenating two string literals ${left.text} + ${right.text} — merge them into one literal.`,
      sourceCode,
      'Combine the adjacent string literals into a single literal.',
    )
  },
}
