import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES } from './_helpers.js'

export const noReturnAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-return-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'await_expression') return null

    let parent = node.parent
    while (parent) {
      if (JS_FUNCTION_TYPES.includes(parent.type)) {
        const isAsync = parent.children.some((c) => c.type === 'async')
        if (isAsync) {
          let tryParent = node.parent
          while (tryParent && tryParent.id !== parent.id) {
            if (tryParent.type === 'try_statement') return null
            tryParent = tryParent.parent
          }

          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Redundant return await',
            '`return await` is redundant in an async function. The function already returns a promise.',
            sourceCode,
            'Remove the `await` keyword: `return promise` instead of `return await promise`.',
          )
        }
        break
      }
      parent = parent.parent
    }
    return null
  },
}
