import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES } from './_helpers.js'

export const functionInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/function-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    // Skip arrow functions used as callbacks (arguments to a call)
    // These are standard patterns: Promise callbacks, .map(), .then(), setTimeout, etc.
    if (node.type === 'arrow_function') {
      if (node.parent?.type === 'arguments' || node.parent?.type === 'new_expression') return null
      // Skip arrow functions assigned to a local `const` binding. The const
      // declaration creates a fresh per-iteration binding (ES6+), so capturing
      // by reference is well-defined. These are typically named local helpers
      // invoked synchronously within the same iteration (Promise.all batching,
      // small extracted callbacks). The classic closure-in-loop bug requires
      // a non-arrow `function` expression or a `var`-bound mutable index.
      if (node.parent?.type === 'variable_declarator') {
        const declaration = node.parent.parent
        if (declaration?.type === 'lexical_declaration') {
          const kindNode = declaration.firstChild
          if (kindNode?.text === 'const') return null
        }
      }
    }

    // Skip functions used as property values in objects (config callbacks, options)
    if (node.parent?.type === 'pair') return null

    const LOOP_TYPES = new Set(['for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'for_of_statement'])
    let parent = node.parent
    while (parent) {
      if (LOOP_TYPES.has(parent.type)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function defined in loop',
          'Function defined inside a loop captures loop variables by reference, which can cause subtle bugs.',
          sourceCode,
          'Move the function outside the loop, or use block-scoped `let` and closures carefully.',
        )
      }
      if (JS_FUNCTION_TYPES.includes(parent.type) && parent.id !== node.id) break
      parent = parent.parent
    }
    return null
  },
}
