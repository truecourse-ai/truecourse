import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { EXPRESS_ROUTE_METHODS } from './_helpers.js'

export const missingRateLimitingVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-rate-limiting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check files that define routes
    if (!filePath.match(/(?:route|controller|api|server|app)/i)) return null

    const text = sourceCode
    const hasRoutes = EXPRESS_ROUTE_METHODS.has('get') && (
      text.includes('app.get(') || text.includes('router.get(') ||
      text.includes('app.post(') || text.includes('router.post(')
    )
    if (!hasRoutes) return null

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
