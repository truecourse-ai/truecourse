import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsMethodCall } from './_helpers.js'

const NEEDS_CLEANUP_METHODS = new Set(['addEventListener', 'setInterval', 'setTimeout'])

function hasReturnStatement(body: SyntaxNode): boolean {
  // Search recursively. The cleanup function is sometimes returned
  // from inside an if/try block (\`if (canceled) return; ...; return
  // () => removeEventListener(...);\`) — top-level-only matching
  // missed those.
  function walk(n: SyntaxNode): boolean {
    if (n.type === 'return_statement') {
      // Only count returns whose value is a function expression /
      // arrow / identifier (a cleanup function reference). A bare
      // \`return;\` early-exit isn't a cleanup.
      const val = n.namedChild(0)
      if (!val) return false
      if (val.type === 'arrow_function' || val.type === 'function_expression' ||
          val.type === 'function' || val.type === 'identifier') return true
      return false
    }
    // Don't descend into NESTED functions (other than the body itself)
    // — their returns belong to themselves.
    if (n !== body && (n.type === 'arrow_function' ||
        n.type === 'function_expression' || n.type === 'function' ||
        n.type === 'method_definition')) return false
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && walk(c)) return true
    }
    return false
  }
  return walk(body)
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
