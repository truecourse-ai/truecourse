import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { EXPRESS_ROUTE_METHODS } from './_helpers.js'

/**
 * Walk the AST to find actual call expressions that look like route definitions:
 *   app.get('/path', handler)
 *   router.post('/path', handler)
 *   etc.
 *
 * This replaces the previous text-grep + always-true `EXPRESS_ROUTE_METHODS.has('get')`
 * check, which was broken (the .has('get') was a constant that always returned true,
 * defeating the entire condition).
 */
function hasExpressLikeRoute(root: SyntaxNode): boolean {
  function walk(n: SyntaxNode): boolean {
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object')
        const prop = fn.childForFieldName('property')
        if (obj && prop && EXPRESS_ROUTE_METHODS.has(prop.text)) {
          // Common Express-style route receivers: `app`, `router`, `route`
          if (obj.type === 'identifier' && /^(app|router|route)$/i.test(obj.text)) {
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

export const missingRateLimitingVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-rate-limiting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check files that define routes
    if (!filePath.match(/(?:route|controller|api|server|app)/i)) return null

    // Real AST check for route definitions, not text grep.
    if (!hasExpressLikeRoute(node)) return null

    // NOTE: Phase 3 will replace this substring-based rate-limiter detection with
    // framework-aware import detection. For now we keep the existing heuristic to
    // avoid scope creep — the always-true bug above was the actual blocker.
    const text = sourceCode.replace(/\/\/.*$/gm, '')
    const hasRateLimiting =
      text.includes('rateLimit') ||
      text.includes('rate-limit') ||
      text.includes('rateLimiter') ||
      text.includes('RateLimiter') ||
      text.includes('throttle') ||
      text.includes('slowDown')

    if (hasRateLimiting) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'API without rate limiting',
      'Route file has no rate limiting middleware. APIs should be rate-limited to prevent abuse.',
      sourceCode,
      'Add rate limiting: app.use(rateLimit({ windowMs: 15*60*1000, max: 100 }))',
    )
  },
}
