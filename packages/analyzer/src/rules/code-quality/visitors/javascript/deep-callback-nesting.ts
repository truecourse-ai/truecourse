import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const deepCallbackNestingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deep-callback-nesting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent

    while (parent) {
      if (parent.type === 'arguments') {
        depth++
        if (depth >= 4) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Deep callback nesting',
            `Callback nested ${depth} levels deep — refactor using async/await or named functions.`,
            sourceCode,
            'Extract nested callbacks into named functions or use async/await to flatten the nesting.',
          )
        }
      }

      if ((parent.type === 'function_declaration') || parent.type === 'program') break

      parent = parent.parent
    }
    return null
  },
}
