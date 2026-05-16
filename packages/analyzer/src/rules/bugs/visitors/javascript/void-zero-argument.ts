import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const voidZeroArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/void-zero-argument',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'void')
    if (!op) return null

    // Only flag `void 0` — the deprecated idiom for `undefined`. Other forms
    // (`void someCall()`, `void await expr`, `void promise`) are intentional
    // discards (forcing undefined return / suppressing returned-value warnings).
    const operand = node.namedChildren[0]
    if (!operand) return null
    if (operand.type !== 'number' || operand.text !== '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unnecessary void expression',
      `\`${node.text}\` can be replaced with \`undefined\` directly.`,
      sourceCode,
      'Use `undefined` instead of `void 0`.',
    )
  },
}
