import type { Node as SyntaxNode } from 'web-tree-sitter'
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
        // Inline callback-position arrows (call args, JSX attribute values like
        // `onChange={(v) => ...}`, render props) aren't real nesting — they're
        // the idiomatic shape for event handlers / map predicates / etc. Skip
        // them so the rule only fires on actual nested-helper definitions.
        if (!isInlineCallbackArrow(parent)) {
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

function isInlineCallbackArrow(fn: SyntaxNode): boolean {
  if (fn.type !== 'arrow_function') return false
  const parent = fn.parent
  if (!parent) return false
  // Call argument: `foo(() => …)` / `arr.map(x => …)`
  if (parent.type === 'arguments') return true
  // JSX attribute expression: `<C onClick={() => …} />`, `<F render={…} />`
  if (parent.type === 'jsx_expression') return true
  // Object literal value: `{ onClick: () => … }` — but only when it's not the
  // top-level object of a const declaration (which is a real definition).
  if (parent.type === 'pair') {
    const obj = parent.parent
    if (obj?.type === 'object' && obj.parent?.type === 'arguments') return true
    if (obj?.type === 'object' && obj.parent?.type === 'jsx_expression') return true
  }
  return false
}
