import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const forInWithoutFilterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/for-in-without-filter',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_in_statement'],
  visit(node, filePath, sourceCode) {
    const hasOf = node.children.some((c) => c.type === 'of')
    if (hasOf) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function hasOwnPropertyCheck(n: SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'member_expression') {
          const prop = fn.childForFieldName('property')
          if (prop?.text === 'hasOwnProperty' || prop?.text === 'hasOwn') return true
        }
      }
      if (n.type === 'string' && (n.text.includes('hasOwnProperty') || n.text.includes('hasOwn'))) return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasOwnPropertyCheck(child)) return true
      }
      return false
    }

    if (!hasOwnPropertyCheck(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'for-in without hasOwnProperty check',
        '`for...in` iterates inherited properties. Add an `Object.hasOwn(obj, key)` check inside the loop.',
        sourceCode,
        'Add `if (!Object.hasOwn(obj, key)) continue;` at the start of the loop body, or use `for...of Object.keys(obj)` instead.',
      )
    }
    return null
  },
}
