import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getFunctionName } from './_helpers.js'

export const deeplyNestedFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function_expression'
        || parent.type === 'arrow_function' || parent.type === 'method_definition') {
        // Don't count arrow functions passed as callback arguments as nesting levels
        const isCallbackArrow = parent.type === 'arrow_function' && parent.parent?.type === 'arguments'
        if (!isCallbackArrow) {
          depth++
        }
      }
      parent = parent.parent
    }

    if (depth >= 3) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deeply nested function',
        `Function \`${name}\` is nested ${depth} levels deep. Extract to module scope for better readability.`,
        sourceCode,
        'Move the function to module scope or a separate file.',
      )
    }
    return null
  },
}
