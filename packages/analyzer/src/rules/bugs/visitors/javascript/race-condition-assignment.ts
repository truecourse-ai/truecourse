import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const raceConditionAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/race-condition-assignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag x += await ... or x -= await ...
    const right = node.childForFieldName('right')
    if (!right) return null

    function containsAwait(n: SyntaxNode): boolean {
      if (n.type === 'await_expression') return true
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsAwait(child)) return true
      }
      return false
    }

    if (!containsAwait(right)) return null

    // Make sure we're inside an async function
    let current: SyntaxNode | null = node.parent
    let inAsync = false
    while (current) {
      if (current.type === 'function_declaration' || current.type === 'function' ||
          current.type === 'arrow_function' || current.type === 'method_definition') {
        inAsync = current.children.some((c) => c.text === 'async')
        break
      }
      current = current.parent
    }
    if (!inAsync) return null

    const left = node.childForFieldName('left')
    const op = node.children.find((c) => ['+=', '-=', '*=', '/=', '|=', '&='].includes(c.text))

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Race condition assignment',
      `\`${left?.text} ${op?.text} await ...\` reads \`${left?.text}\`, suspends at \`await\`, and writes back — a concurrent modification between the read and write is silently overwritten.`,
      sourceCode,
      'Store the awaited value in a local variable first, then apply the operation atomically.',
    )
  },
}
