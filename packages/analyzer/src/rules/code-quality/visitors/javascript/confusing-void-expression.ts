import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Expression of type void used in a non-statement position.
 * Corresponds to @typescript-eslint/no-confusing-void-expression.
 */
export const confusingVoidExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/confusing-void-expression',
  languages: TS_LANGUAGES,
  nodeTypes: ['return_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const value = node.namedChildren[0]
    if (!value) return null

    // Check if the returned expression is void
    const isVoid = typeQuery.isVoidType(
      filePath,
      value.startPosition.row,
      value.startPosition.column,
    )
    if (!isVoid) return null

    // Check that the containing function doesn't have void return type itself
    // (returning void from void function is fine, it's shorthand)
    let parent = node.parent
    while (parent) {
      if (parent.type === 'arrow_function') {
        // Arrow functions with expression body: `() => voidFn()` — this is fine
        if (parent.childForFieldName('body')?.type !== 'statement_block') {
          return null
        }
        break
      }
      if (parent.type === 'function_declaration' || parent.type === 'function_expression' ||
          parent.type === 'method_definition') {
        break
      }
      parent = parent.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Returning void expression',
      `Returning a void expression — \`${value.text.slice(0, 40)}\` returns \`undefined\`. This is confusing because it looks like the return value matters.`,
      sourceCode,
      'Put the expression on its own line and use a bare `return` statement.',
    )
  },
}
