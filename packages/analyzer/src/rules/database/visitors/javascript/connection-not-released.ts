import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, CONNECTION_ACQUIRE_METHODS, isInsideTryBody } from './_helpers.js'

export const connectionNotReleasedVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/connection-not-released',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!CONNECTION_ACQUIRE_METHODS.has(methodName)) return null

    // If the call is inside a try block, that's fine — assume finally releases it
    if (isInsideTryBody(node)) return null

    // Check if there's a .release() or similar chained immediately — acceptable pattern
    const parent = node.parent
    if (parent?.type === 'await_expression') {
      const grandParent = parent.parent
      // e.g. const client = await pool.connect()
      // We flag this only if we can confirm no finally block wraps it
      if (grandParent && isInsideTryBody(grandParent)) return null
    }

    // Also check for "using" declarations (TS resource management)
    const varDeclarator = node.parent?.parent
    if (varDeclarator?.type === 'using_declaration' || varDeclarator?.type === 'await_using_declaration') {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Database connection not released',
      `${methodName}() acquires a connection but it may not be released if an error occurs. Wrap in a try/finally block and call release() in the finally clause.`,
      sourceCode,
      'Use try/finally to guarantee connection.release() is called even when an exception is thrown.',
    )
  },
}
