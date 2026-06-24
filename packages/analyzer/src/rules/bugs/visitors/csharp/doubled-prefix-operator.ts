import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Prefix operators that are pointless (or a typo) when doubled. */
const DOUBLEABLE = new Set(['~'])

/**
 * `~~y` — a doubled bitwise-complement operator, which is just `y` and so is at
 * best redundant and far more often a typo. Doubled `-`/`+` are valid (unary
 * minus of a literal). Doubled logical negation (`!!x`) is owned by the
 * dedicated `code-quality/deterministic/double-negation` rule and is left to it
 * here to avoid double-reporting the same expression.
 */
export const csharpDoubledPrefixOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/doubled-prefix-operator',
  languages: ['csharp'],
  nodeTypes: ['prefix_unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.child(0)
    if (!op || !DOUBLEABLE.has(op.type)) return null

    const operand = node.namedChildren[0]
    if (operand?.type !== 'prefix_unary_expression') return null
    const innerOp = operand.child(0)
    if (!innerOp || innerOp.type !== op.type) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Doubled prefix operator',
      `\`${op.type}${op.type}\` cancels itself out, so this doubled operator is either redundant or a typo.`,
      sourceCode,
      `Remove the duplicate \`${op.type}\`, or fix the expression if a different operator was intended.`,
    )
  },
}
