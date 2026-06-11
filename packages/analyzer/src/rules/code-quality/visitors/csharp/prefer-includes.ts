import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

function isNegOne(n: SyntaxNode): boolean {
  return n.type === 'prefix_unary_expression'
    && n.children.some((c) => c?.type === '-')
    && n.namedChildren[0]?.text === '1'
}

function isZero(n: SyntaxNode): boolean {
  return n.type === 'integer_literal' && n.text === '0'
}

/** Existence-test IndexOf call: 1 arg, or 2 args where the second is a StringComparison. */
function isIndexOfCall(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  if (getCSharpMethodName(n) !== 'IndexOf') return false
  const args = n.childForFieldName('arguments')?.namedChildren ?? []
  if (args.length === 1) return true
  if (args.length === 2) return (args[1]?.text ?? '').includes('StringComparison')
  return false
}

/**
 * `IndexOf(x) >= 0` / `!= -1` used as a pure existence test — `Contains(x)`
 * says it directly (CA2249). Comparisons against `== 0` are excluded (those
 * are the StartsWith shape, owned by substring-over-starts-ends), as are
 * `IndexOf(x, startIndex)` overloads which Contains cannot replicate.
 */
export const csharpPreferIncludesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-includes',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text ?? ''
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftIsIndexOf = left.type === 'invocation_expression' && isIndexOfCall(left)
    const rightIsIndexOf = right.type === 'invocation_expression' && isIndexOfCall(right)
    if (leftIsIndexOf === rightIsIndexOf) return null
    const other = leftIsIndexOf ? right : left
    // Normalize to `IndexOf(…) <op> value` orientation.
    const effectiveOp = leftIsIndexOf ? op : { '<': '>', '>': '<', '<=': '>=', '>=': '<=' }[op] ?? op

    const existence =
      ((effectiveOp === '!=' || effectiveOp === '==' || effectiveOp === '>' || effectiveOp === '<=') && isNegOne(other)) ||
      ((effectiveOp === '>=' || effectiveOp === '<') && isZero(other))
    if (!existence) return null

    const negated = effectiveOp === '==' || effectiveOp === '<=' || effectiveOp === '<'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer Contains()',
      `\`IndexOf(…) ${op} ${other.text}\` is an existence test — \`${negated ? '!' : ''}Contains(…)\` states the intent directly (CA2249).`,
      sourceCode,
      `Replace the IndexOf comparison with \`${negated ? '!' : ''}value.Contains(x)\`.`,
    )
  },
}
