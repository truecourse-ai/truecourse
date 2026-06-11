import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ARITHMETIC_OPS = new Set(['+', '-', '*', '/', '%'])

function isIncrementOrDecrement(node: SyntaxNode | null): boolean {
  if (!node) return false
  if (node.type !== 'postfix_unary_expression' && node.type !== 'prefix_unary_expression') return false
  return node.children.some((c) => c?.type === '++' || c?.type === '--')
}

/**
 * `++` / `--` used as an operand of arithmetic (`total = x++ + y`) — the
 * side effect buried in the expression makes evaluation order hard to
 * read. Idiomatic uses (`for (...; i++)`, `buffer[pos++]`, `y = x++`) are
 * not arithmetic operands and are never flagged.
 */
export const csharpConfusingIncrementDecrementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/confusing-increment-decrement',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.childForFieldName('operator')?.text ?? ''
    if (!ARITHMETIC_OPS.has(operator)) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!isIncrementOrDecrement(left) && !isIncrementOrDecrement(right)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Confusing increment/decrement',
      `\`${node.text}\` mixes \`++\`/\`--\` with arithmetic — the embedded side effect makes the evaluation order confusing.`,
      sourceCode,
      'Move the increment/decrement to its own statement before or after the expression.',
    )
  },
}
