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
    let outermostIsTopLevelArrow = false

    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function_expression'
        || parent.type === 'arrow_function' || parent.type === 'method_definition') {
        // Don't count arrow functions passed as callback arguments
        // OR JSX prop expressions (event handlers, render props) as
        // nesting levels. JSX-heavy components legitimately hit
        // depth=3+ via FormField → render → child arrows; those
        // are structural, not "deeply nested business logic".
        const isCallbackArrow = parent.type === 'arrow_function' && parent.parent?.type === 'arguments'
        const isJsxExpressionArrow = parent.type === 'arrow_function' && parent.parent?.type === 'jsx_expression'
        if (!isCallbackArrow && !isJsxExpressionArrow) {
          depth++
        }
        // Track whether the outermost ancestor function is a
        // module-level const-assigned arrow (typical React
        // component shape `export const Foo = () => {...}`).
        // When the depth count includes that component-scope
        // arrow, we bump the threshold so the chain
        // `component → helper → inner` (3 arrows) doesn't
        // flag — but `outer → helper → inner → leaf` (4) still
        // does.
        if (parent.type === 'arrow_function' && parent.parent?.type === 'variable_declarator') {
          const decl = parent.parent.parent  // lexical_declaration / variable_declaration
          if (decl?.parent?.type === 'program' || decl?.parent?.type === 'export_statement') {
            outermostIsTopLevelArrow = true
          }
        }
      }
      parent = parent.parent
    }

    const threshold = outermostIsTopLevelArrow ? 4 : 3

    if (depth >= threshold) {
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
