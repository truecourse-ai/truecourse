import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unmodifiedLoopConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unmodified-loop-condition',
  languages: JS_LANGUAGES,
  nodeTypes: ['while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Get the inner condition (unwrap parenthesized_expression)
    const inner = condition.type === 'parenthesized_expression'
      ? condition.namedChildren[0]
      : condition
    if (!inner) return null

    // Only handle simple binary conditions with an identifier
    if (inner.type !== 'binary_expression') return null

    const left = inner.childForFieldName('left')
    const right = inner.childForFieldName('right')
    if (!left || !right) return null

    // Collect identifiers from the condition
    const condVars: string[] = []
    if (left.type === 'identifier') condVars.push(left.text)
    if (right.type === 'identifier') condVars.push(right.text)
    if (condVars.length === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if any condition variable is modified in the body
    function isModified(n: SyntaxNode): boolean {
      // Assignment: x = ..., x += ...
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const lhs = n.childForFieldName('left')
        if (lhs && condVars.includes(lhs.text)) return true
      }
      // Update: x++, x--, ++x, --x
      if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument')
        if (arg && condVars.includes(arg.text)) return true
      }
      // Function call could modify anything — bail out
      if (n.type === 'call_expression') return true
      // yield/await could modify state
      if (n.type === 'yield_expression' || n.type === 'await_expression') return true
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && isModified(child)) return true
      }
      return false
    }

    if (!isModified(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unmodified loop condition',
        `Condition variable${condVars.length > 1 ? 's' : ''} \`${condVars.join('`, `')}\` ${condVars.length > 1 ? 'are' : 'is'} never modified inside the loop body.`,
        sourceCode,
        'Modify the condition variable inside the loop or use a different loop structure.',
      )
    }
    return null
  },
}
