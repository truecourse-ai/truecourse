import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects CORSMiddleware added before other middlewares in FastAPI.
 * S8414: CORSMiddleware should be added last in the middleware chain.
 *
 * Pattern: app.add_middleware(CORSMiddleware, ...) appears before other
 * app.add_middleware() calls.
 */
export const pythonFastapiCorsMiddlewareOrderVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fastapi-cors-middleware-order',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Collect all add_middleware calls in order
    const middlewareCalls: Array<{ isCors: boolean; n: import('tree-sitter').SyntaxNode }> = []

    function findMiddlewareCalls(n: import('tree-sitter').SyntaxNode): void {
      if (n.type === 'call') {
        const func = n.childForFieldName('function')
        if (func?.type === 'attribute') {
          const attr = func.childForFieldName('attribute')
          if (attr?.text === 'add_middleware') {
            const args = n.childForFieldName('arguments')
            const firstArg = args?.namedChildren[0]
            const isCors = firstArg?.text === 'CORSMiddleware' ||
              firstArg?.text?.endsWith('.CORSMiddleware') || false
            middlewareCalls.push({ isCors, n })
          }
        }
      }

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) findMiddlewareCalls(child)
      }
    }

    findMiddlewareCalls(node)

    if (middlewareCalls.length < 2) return null

    // Find the first CORSMiddleware call
    const corsIndex = middlewareCalls.findIndex((m) => m.isCors)
    if (corsIndex === -1) return null

    // Check if there are non-CORS middlewares added after CORSMiddleware
    const hasMiddlewareAfterCors = middlewareCalls.slice(corsIndex + 1).some((m) => !m.isCors)

    if (!hasMiddlewareAfterCors) return null

    const corsCall = middlewareCalls[corsIndex].n
    return makeViolation(
      this.ruleKey, corsCall, filePath, 'high',
      'CORSMiddleware not added last',
      '`CORSMiddleware` is added before other middlewares. In FastAPI, middlewares are applied in reverse order — `CORSMiddleware` should be added last so it is applied first and can set CORS headers before other middleware processes the response.',
      sourceCode,
      'Move `app.add_middleware(CORSMiddleware, ...)` to be the last middleware added.',
    )
  },
}
