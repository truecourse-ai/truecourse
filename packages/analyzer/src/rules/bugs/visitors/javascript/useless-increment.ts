import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const uselessIncrementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-increment',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Check for standalone x++ or ++x that's not inside a for loop increment
    if (expr.type !== 'update_expression') return null

    // Make sure the parent is not a for_statement increment position
    const parent = node.parent
    if (parent?.type === 'for_statement') {
      // Check if this statement_block is the increment part — actually update_expression in for is not wrapped in expression_statement
      // So this check is fine as-is, expression_statement in for body is the loop body
    }

    const arg = expr.childForFieldName('argument')
    if (!arg) return null

    // Only flag if this is the only expression (standalone statement) — that's what expression_statement means
    // And the result is not used anywhere immediately after (we can't easily check that, so we skip this rule
    // for now and only flag the specific case where the prefix result of ++x is the standalone expression)
    const op = expr.children.find((c) => c.text === '++' || c.text === '--')
    if (!op) return null

    // Detect pre-increment whose result goes unused: the parent is expression_statement (already confirmed)
    // and it's a pre-increment/decrement (operator before argument)
    const isPre = expr.children.indexOf(op) < expr.children.indexOf(arg)
    if (isPre) {
      return makeViolation(
        this.ruleKey, expr, filePath, 'medium',
        'Useless pre-increment',
        `The result of \`${expr.text}\` is not used — pre-increment/decrement as a standalone statement is equivalent to post-increment.`,
        sourceCode,
        `Replace \`${op.text}${arg.text}\` with \`${arg.text}${op.text}\` if the intent is to mutate, or use \`${arg.text} ${op.text === '++' ? '+= 1' : '-= 1'}\`.`,
      )
    }

    return null
  },
}
