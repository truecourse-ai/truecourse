import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { EXPRESS_ROUTE_METHODS } from './_helpers.js'
import {
  detectWebFramework,
  importsRateLimiter,
  isRateLimitMiddlewareName,
} from '../../../_shared/framework-detection.js'

/**
 * Walk the AST to find actual call expressions that look like route definitions:
 *   app.get('/path', handler)
 *   router.post('/path', handler)
 *   etc.
 */
function hasWebRoute(root: SyntaxNode): boolean {
  function walk(n: SyntaxNode): boolean {
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object')
        const prop = fn.childForFieldName('property')
        if (obj && prop && EXPRESS_ROUTE_METHODS.has(prop.text)) {
          // Common route receivers across Express/Fastify/Koa/Hono: app, router, route
          if (obj.type === 'identifier' && /^(app|router|route|fastify|server)$/i.test(obj.text)) {
            return true
          }
        }
      }
    }
    for (const child of n.namedChildren) {
      if (walk(child)) return true
    }
    return false
  }
  return walk(root)
}

/**
 * Walk the AST looking for any call to a rate-limit middleware identifier.
 * Catches both the import-and-call pattern (`app.use(rateLimit({...}))`)
 * and the variable pattern (`const limiter = rateLimit(...); app.use(limiter)`).
 */
function hasRateLimitMiddlewareCall(root: SyntaxNode): boolean {
  function walk(n: SyntaxNode): boolean {
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      let name = ''
      if (fn?.type === 'identifier') name = fn.text
      else if (fn?.type === 'member_expression') name = fn.childForFieldName('property')?.text ?? ''
      if (name && isRateLimitMiddlewareName(name)) return true
    }
    for (const child of n.namedChildren) {
      if (walk(child)) return true
    }
    return false
  }
  return walk(root)
}

export const missingRateLimitingVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-rate-limiting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Skip if we don't recognize the framework — without that, we can't tell
    // whether the route is real or whether rate limiting is applied externally.
    const framework = detectWebFramework(node)
    if (framework === 'unknown') return null

    // Need at least one route definition in this file
    if (!hasWebRoute(node)) return null

    // Skip if a rate-limiter package is imported (covers all the supported
    // frameworks: express-rate-limit, @fastify/rate-limit, koa-ratelimit, etc.)
    if (importsRateLimiter(node)) return null

    // Skip if a rate-limit middleware is called by name anywhere in the file
    // (e.g. project-local `rateLimiter()` helper, custom `throttle()` middleware).
    if (hasRateLimitMiddlewareCall(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'API without rate limiting',
      `Route file uses ${framework} but has no rate limiting middleware. APIs should be rate-limited to prevent abuse.`,
      sourceCode,
      'Add rate limiting middleware (e.g. express-rate-limit, @fastify/rate-limit, hono-rate-limiter).',
    )
  },
}
