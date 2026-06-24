import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A ternary that returns the tested value when it is non-null and a fallback
 * otherwise — `a != null ? a : b` — restates exactly what the `??` operator
 * does, but evaluates `a` twice and reads less directly. The mirror form
 * `a == null ? b : a` is the same pattern. The check requires the non-null
 * branch to be textually identical to the operand compared against `null`.
 */
export const csharpUseNullCoalescingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-null-coalescing',
  languages: ['csharp'],
  nodeTypes: ['conditional_expression'],
  visit(node, filePath, sourceCode) {
    const cond = node.childForFieldName('condition')
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (cond?.type !== 'binary_expression' || !consequence || !alternative) return null

    const op = cond.childForFieldName('operator')?.text
    if (op !== '!=' && op !== '==') return null
    const left = cond.childForFieldName('left')
    const right = cond.childForFieldName('right')
    if (!left || !right) return null

    // Identify the operand compared against `null`.
    let tested: string | null = null
    if (right.type === 'null_literal') tested = left.text
    else if (left.type === 'null_literal') tested = right.text
    if (tested === null) return null

    // `x != null ? x : fallback`  or  `x == null ? fallback : x`
    const nonNullBranch = op === '!=' ? consequence : alternative
    if (nonNullBranch.text !== tested) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use ?? instead of a null-check conditional',
      `\`${cond.text} ? … : …\` restates the \`??\` operator, which evaluates \`${tested}\` once.`,
      sourceCode,
      'Replace the null-check ternary with the `??` operator.',
    )
  },
}
