import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function unwrapParens(node: SyntaxNode | null): SyntaxNode | null {
  while (node?.type === 'parenthesized_expression') {
    node = node.namedChildren[0] ?? null
  }
  return node
}

/** For `expr != null`, returns the non-null operand; null otherwise. */
function nullCheckOperand(node: SyntaxNode | null): SyntaxNode | null {
  const n = unwrapParens(node)
  if (n?.type !== 'binary_expression') return null
  if (n.childForFieldName('operator')?.text !== '!=') return null
  const left = n.childForFieldName('left')
  const right = n.childForFieldName('right')
  if (!left || !right) return null
  if (right.type === 'null_literal') return left
  if (left.type === 'null_literal') return right
  return null
}

/**
 * `x != null && x.Y != null` → `x?.Y != null`. Only the equivalent rewrite
 * is suggested — bare `x != null && x.IsActive` is NOT flagged, since its
 * `?.` form requires a `== true` comparison that many C# teams reject.
 */
export const csharpPreferOptionalChainVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-optional-chain',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '&&') return null

    const guarded = nullCheckOperand(node.childForFieldName('left'))
    if (!guarded) return null
    if (guarded.type !== 'identifier' && guarded.type !== 'member_access_expression') return null

    const rightOperand = nullCheckOperand(node.childForFieldName('right'))
    if (!rightOperand) return null
    if (rightOperand.type !== 'member_access_expression') return null
    if (!rightOperand.text.startsWith(`${guarded.text}.`)) return null

    const chained = `${guarded.text}?.${rightOperand.text.slice(guarded.text.length + 1)}`
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer null-conditional operator',
      `\`${guarded.text} != null && ${rightOperand.text} != null\` collapses to \`${chained} != null\`.`,
      sourceCode,
      `Replace the chained null checks with \`${chained} != null\`.`,
    )
  },
}
