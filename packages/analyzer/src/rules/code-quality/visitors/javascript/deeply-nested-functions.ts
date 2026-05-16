import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getFunctionName } from './_helpers.js'

export const deeplyNestedFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  // Only flag named function declarations / methods. Arrow functions and
  // anonymous function expressions are almost always callbacks/closures
  // (event handlers, render props, setTimeout, .map, IIFEs, helpers assigned
  // to const) — visual indentation, not real "deeply nested function" intent.
  nodeTypes: ['function_declaration', 'method_definition'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function_expression'
        || parent.type === 'arrow_function' || parent.type === 'method_definition') {
        // Skip ancestor function nodes that are not real "nesting levels":
        // - arrow/function passed as a call argument (callback)
        // - arrow/function used as a JSX prop value (render prop, event handler)
        // - arrow/function assigned to a variable_declarator (named helper closure)
        // These are common React/JS idioms; counting them produces false positives.
        const isCallback = parent.parent?.type === 'arguments'
        const isJsxPropValue =
          parent.parent?.type === 'jsx_expression' &&
          parent.parent.parent?.type === 'jsx_attribute'
        const isAssignedToVariable =
          (parent.type === 'arrow_function' || parent.type === 'function_expression') &&
          parent.parent?.type === 'variable_declarator'
        const skip =
          (parent.type === 'arrow_function' || parent.type === 'function_expression') &&
          (isCallback || isJsxPropValue || isAssignedToVariable)
        if (!skip) {
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
