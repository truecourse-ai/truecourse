import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const lostErrorContextVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lost-error-context',
  languages: JS_LANGUAGES,
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const param = node.childForFieldName('parameter')
    if (!param || param.type !== 'identifier') return null
    const paramName = param.text

    const body = node.childForFieldName('body')
    if (!body) return null

    // Look for: paramName = <something else> (not just reassigning — replacing the error)
    function findReplacement(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        const right = n.childForFieldName('right')
        if (left?.type === 'identifier' && left.text === paramName) {
          // Only flag if right side is NOT null/undefined (that would be intentional cleanup)
          if (right && right.type !== 'null' && right.type !== 'undefined') {
            return n
          }
        }
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReplacement(child)
          if (found) return found
        }
      }
      return null
    }

    const replacement = findReplacement(body)
    if (replacement) {
      return makeViolation(
        this.ruleKey, replacement, filePath, 'medium',
        'Lost error context',
        `Reassigning \`${paramName}\` in a catch block loses the original error information.`,
        sourceCode,
        'Use a different variable name to store the new value, preserving the original error.',
      )
    }
    return null
  },
}
