import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/** A LINQ `Count()` / `LongCount()` CALL (the `.Count` property is O(1) and fine). */
function isCountCall(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  const name = getCSharpMethodName(n)
  if (name !== 'Count' && name !== 'LongCount') return false
  return (n.childForFieldName('arguments')?.namedChildCount ?? 0) <= 1
}

/**
 * `Count() == 0` / `Count() > 0` style emptiness tests — `Any()` answers the
 * question without enumerating the whole sequence (CA1827). The `.Count`
 * PROPERTY on collections is not flagged; only the LINQ method call is.
 */
export const csharpLenTestVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/len-test',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text ?? ''
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftIsCount = isCountCall(left)
    const rightIsCount = isCountCall(right)
    if (leftIsCount === rightIsCount) return null
    const other = leftIsCount ? right : left
    if (other.type !== 'integer_literal') return null
    const effectiveOp = leftIsCount ? op : ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' }[op] ?? op)

    const value = other.text
    let replacement: string | null = null
    if (value === '0') {
      if (effectiveOp === '==' || effectiveOp === '<=') replacement = '!xs.Any()'
      else if (effectiveOp === '!=' || effectiveOp === '>') replacement = 'xs.Any()'
    } else if (value === '1') {
      if (effectiveOp === '>=') replacement = 'xs.Any()'
      else if (effectiveOp === '<') replacement = '!xs.Any()'
    }
    if (!replacement) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Count() used as emptiness test',
      `\`Count() ${op} ${value}\` enumerates the whole sequence to answer a yes/no question — \`${replacement.replace('xs.', '')}\` stops at the first element (CA1827).`,
      sourceCode,
      `Replace the Count() comparison with \`${replacement}\` (same predicate argument if one was passed).`,
    )
  },
}
