import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `&&` binds tighter than `||`, so `a || b && c` means `a || (b && c)` — a
 * frequent source of misread intent. The rule fires on a top-level `||` whose
 * operand is an unparenthesized `&&`, where explicit parentheses around the
 * `&&` group remove the ambiguity. A parenthesized operand means the author
 * already disambiguated.
 */

function binaryOp(node: SyntaxNode): string | null {
  if (node.type !== 'binary_expression') return null
  return node.childForFieldName('operator')?.text ?? null
}

/**
 * Walk a `||` chain and return true if any unparenthesized operand is a `&&`
 * expression. Operands that are themselves `||` continue the chain;
 * parenthesized operands stop it.
 */
function hasUnparenthesizedAnd(node: SyntaxNode): boolean {
  for (const side of ['left', 'right'] as const) {
    const child = node.childForFieldName(side)
    if (!child || child.type === 'parenthesized_expression') continue
    const childOp = binaryOp(child)
    if (childOp === '&&') return true
    if (childOp === '||' && hasUnparenthesizedAnd(child)) return true
  }
  return false
}

export const csharpConditionalPrecedenceParenthesesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/conditional-precedence-parentheses',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (binaryOp(node) !== '||') return null

    // Report only on the outermost `||` so a chain (`a && b || c && d`) yields a
    // single finding.
    if (binaryOp(node.parent ?? node) === '||') return null

    if (!hasUnparenthesizedAnd(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unclear conditional precedence',
      `\`${node.text}\` mixes \`&&\` and \`||\` without parentheses; add parentheses to make the grouping explicit.`,
      sourceCode,
      'Wrap the `&&` sub-expression in parentheses, e.g. `a || (b && c)`.',
    )
  },
}
