import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isRouteHandler } from './_helpers.js'

export const routeWithoutAuthMiddlewareVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/route-without-auth-middleware',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    // Skip health check, login, register, public endpoints
    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (firstArg) {
      const path = firstArg.text.replace(/['"]/g, '')
      const publicPaths = ['/health', '/login', '/register', '/signup', '/auth', '/webhook', '/public']
      if (publicPaths.some((p) => path.includes(p))) return null
    }

    // Check if there's a middleware argument (more than just path + handler)
    const allArgs = args.namedChildren
    if (allArgs.length <= 2) {
      // Only path + handler, no middleware
      // Check if the file has global auth middleware applied
      const fileText = sourceCode
      if (
        fileText.includes('authenticate') ||
        fileText.includes('authMiddleware') ||
        fileText.includes('requireAuth') ||
        fileText.includes('isAuthenticated') ||
        fileText.includes('passport.')
      ) {
        return null
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Route without auth middleware',
        'Route handler has no authentication middleware. Add auth middleware or mark as public.',
        sourceCode,
        'Add auth middleware: app.get("/path", authMiddleware, handler)',
      )
    }

    return null
  },
}
