import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

const LOOP_TYPES = new Set([
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'while_statement',
  'do_statement',
])

// A break_statement whose nearest enclosing break-target is a switch case
// (rather than a loop) is the idiomatic switch-case terminator, not
// "complex control flow" — exclude it from the count.
function isSwitchCaseBreak(breakNode: SyntaxNode, functionNode: SyntaxNode): boolean {
  let parent = breakNode.parent
  while (parent && parent.id !== functionNode.id) {
    if (parent.type === 'switch_case' || parent.type === 'switch_default') return true
    if (LOOP_TYPES.has(parent.type)) return false
    parent = parent.parent
  }
  return false
}

export const tooManyBreaksVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-breaks',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let breakCount = 0

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      if (n.type === 'break_statement' && !isSwitchCaseBreak(n, node)) breakCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (breakCount > 5) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many break statements',
        `Function \`${name}\` has ${breakCount} break statements (max 5). Consider refactoring the control flow.`,
        sourceCode,
        'Refactor using early returns, helper functions, or lookup tables to reduce break usage.',
      )
    }
    return null
  },
}
