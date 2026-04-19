import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

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
      if (n.type === 'break_statement') breakCount++
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
