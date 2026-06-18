import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const COMPARISON_OPS = new Set(['==', '!=', '<', '>', '<=', '>='])

function unwrapParens(node: SyntaxNode | null): SyntaxNode | null {
  while (node?.type === 'parenthesized_expression') {
    node = node.namedChildren[0] ?? null
  }
  return node
}

function isComparison(node: SyntaxNode | null): boolean {
  const inner = unwrapParens(node)
  if (inner?.type !== 'binary_expression') return false
  const op = inner.childForFieldName('operator')?.text ?? ''
  return COMPARISON_OPS.has(op)
}

/**
 * `&` / `|` between two comparison results inside a condition — almost
 * certainly a typo for `&&` / `||`. Note that `&`/`|` on bools is VALID
 * non-short-circuit C#, so only the comparison-between-comparisons shape in
 * a condition position is flagged; deliberate non-short-circuit code on
 * variables/flags is left alone.
 */
export const csharpBitwiseInBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/bitwise-in-boolean',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '&' && op !== '|') return null

    if (!isComparison(node.childForFieldName('left'))) return null
    if (!isComparison(node.childForFieldName('right'))) return null

    // Must be (transitively through parens) the condition of a control-flow
    // statement or ternary.
    let current: SyntaxNode = node
    let parent: SyntaxNode | null = node.parent
    while (parent?.type === 'parenthesized_expression') {
      current = parent
      parent = parent.parent
    }
    if (!parent) return null
    const CONDITION_PARENTS = new Set(['if_statement', 'while_statement', 'do_statement', 'for_statement', 'conditional_expression'])
    if (!CONDITION_PARENTS.has(parent.type)) return null
    if (parent.childForFieldName('condition')?.id !== current.id) return null

    const intended = op === '&' ? '&&' : '||'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Bitwise operator between comparisons',
      `\`${op}\` joins two comparison results in a condition — both sides always evaluate. Did you mean the short-circuiting \`${intended}\`?`,
      sourceCode,
      `Replace \`${op}\` with \`${intended}\` unless non-short-circuit evaluation is deliberately required.`,
    )
  },
}
