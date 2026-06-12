import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, getCSharpFunctionBody, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

const LOOP_NODE_TYPES = new Set([
  'for_statement', 'foreach_statement', 'while_statement', 'do_statement',
])

// A `break` inside a `switch` section is REQUIRED C# syntax (no implicit
// fall-through), not a control-flow exit worth counting. Only loop breaks
// represent the branching this rule discourages.
function breakTargetsLoop(breakNode: SyntaxNode, functionNode: SyntaxNode): boolean {
  let current: SyntaxNode | null = breakNode.parent
  while (current && current.id !== functionNode.id) {
    if (current.type === 'switch_statement') return false
    if (LOOP_NODE_TYPES.has(current.type)) return true
    current = current.parent
  }
  return false
}

export const csharpTooManyBreaksVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-breaks',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getCSharpFunctionBody(node)
    if (!bodyNode) return null

    let breakCount = 0

    function walk(n: SyntaxNode) {
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return
      if (n.type === 'break_statement' && breakTargetsLoop(n, node)) breakCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (breakCount > 5) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many break statements',
        `Method \`${name}\` has ${breakCount} break statements (max 5). Consider refactoring the control flow.`,
        sourceCode,
        'Refactor using early returns, helper methods, or LINQ to reduce break usage.',
      )
    }
    return null
  },
}
