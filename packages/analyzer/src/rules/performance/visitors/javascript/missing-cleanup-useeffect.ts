import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsMethodCall } from './_helpers.js'

const NEEDS_CLEANUP_METHODS = new Set(['addEventListener', 'setInterval', 'setTimeout'])

function hasReturnStatement(body: SyntaxNode): boolean {
  // Direct children of the statement_block that are return_statement
  for (const child of body.namedChildren) {
    if (child.type === 'return_statement') return true
  }
  return false
}

export const missingCleanupUseEffectVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/missing-cleanup-useeffect',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'identifier' || fn.text !== 'useEffect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const callback = args.namedChildren[0]
    if (!callback || (callback.type !== 'arrow_function' && callback.type !== 'function')) return null

    const body = callback.childForFieldName('body')
    if (!body) return null

    // Check if body uses addEventListener, setInterval, or setTimeout
    const usesSubscription = containsMethodCall(body, NEEDS_CLEANUP_METHODS)
    if (!usesSubscription) return null

    // Check if there's a return statement in the callback body (cleanup function)
    const hasCleanup = hasReturnStatement(body)
    if (hasCleanup) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'useEffect missing cleanup',
      'useEffect registers a listener or timer but does not return a cleanup function, which can cause memory leaks.',
      sourceCode,
      'Return a cleanup function from useEffect that removes the listener or clears the timer.',
    )
  },
}
