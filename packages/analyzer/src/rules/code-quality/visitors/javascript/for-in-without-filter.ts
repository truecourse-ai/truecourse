import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

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

    // Any conditional inside the body (if, ternary, &&/||) acts as a filter
    // gating which iterations produce side effects. ESLint's canonical
    // `guard-for-in` rule is satisfied by any guard, not just hasOwnProperty.
    function hasGuardInBody(n: SyntaxNode): boolean {
      if (
        n.type === 'if_statement' ||
        n.type === 'ternary_expression' ||
        n.type === 'continue_statement'
      ) {
        return true
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasGuardInBody(child)) return true
      }
      return false
    }

    if (!hasOwnPropertyCheck(body) && !hasGuardInBody(body)) {
      // Respect explicit author opt-outs via `eslint-disable` for the canonical
      // ESLint rule `guard-for-in`. The pragma may be placed immediately
      // preceding the `for...in` statement or preceding its enclosing function
      // (when the guard is conceptually about the entire helper).
      const nodeStartLine = node.startPosition.row
      const sourceLines = sourceCode.split('\n')
      let scanStart = nodeStartLine
      let parent: SyntaxNode | null = node.parent
      while (parent) {
        if (
          parent.type === 'function_declaration' ||
          parent.type === 'function_expression' ||
          parent.type === 'arrow_function' ||
          parent.type === 'method_definition'
        ) {
          scanStart = parent.startPosition.row
          break
        }
        parent = parent.parent
      }
      const windowLines = sourceLines.slice(Math.max(0, scanStart - 3), nodeStartLine + 1)
      if (windowLines.some((line) => /eslint-disable(?:-next-line)?[^\n]*guard-for-in/.test(line))) {
        return null
      }

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
