import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unthrownErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unthrown-error',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'new_expression') return null

    const constructor = expr.childForFieldName('constructor')
    if (!constructor) return null

    // Match Error, TypeError, RangeError, etc.
    const name = constructor.text
    if (!name.endsWith('Error')) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Error created but not thrown',
      `\`new ${name}(...)\` is created as a standalone expression but never thrown — the error is silently discarded.`,
      sourceCode,
      `Add \`throw\` before \`new ${name}(...)\` or assign it to a variable if needed.`,
    )
  },
}
