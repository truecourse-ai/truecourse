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

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unnecessary void expression',
      `\`${node.text}\` can be replaced with \`undefined\` directly.`,
      sourceCode,
      'Use `undefined` instead of `void 0`.',
    )
  },
}
