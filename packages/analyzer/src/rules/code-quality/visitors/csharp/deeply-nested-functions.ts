import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpFunctionName } from './_helpers.js'

/**
 * Local functions nested 3+ declaration levels deep. Lambdas are NOT counted
 * as levels — callback/LINQ positions are idiomatic, only named
 * local-function declarations create real definition nesting.
 */
export const csharpDeeplyNestedFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-functions',
  languages: ['csharp'],
  nodeTypes: ['local_function_statement'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    while (parent) {
      if (parent.type === 'local_function_statement' || parent.type === 'method_declaration'
        || parent.type === 'constructor_declaration') {
        depth++
      }
      parent = parent.parent
    }

    if (depth >= 3) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deeply nested function',
        `Local function \`${name}\` is nested ${depth} levels deep. Extract it to a private method for better readability.`,
        sourceCode,
        'Move the local function up to a private method on the class.',
      )
    }
    return null
  },
}
