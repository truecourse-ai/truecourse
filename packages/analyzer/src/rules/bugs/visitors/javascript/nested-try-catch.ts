import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects try-catch blocks that are nested inside catch blocks.
 * This leads to convoluted error handling logic.
 */
export const nestedTryCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nested-try-catch',
  languages: JS_LANGUAGES,
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Check if this try statement is inside a catch clause
    let parent = node.parent
    let depth = 0

    while (parent) {
      if (parent.type === 'catch_clause') {
        depth++
        if (depth >= 1) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Deeply nested try-catch blocks',
            'A try-catch block is nested inside a catch handler — this creates convoluted error handling logic that is hard to follow and likely has bugs.',
            sourceCode,
            'Refactor: extract the inner try-catch into a separate function, or restructure error handling to avoid deep nesting.',
          )
        }
      }
      if (
        parent.type === 'function_declaration' ||
        parent.type === 'function' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition'
      ) {
        break
      }
      parent = parent.parent
    }

    return null
  },
}
