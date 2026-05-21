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

      // Also catch the path-mounted pattern:
      //   app.use('/api/v1/*', apiV1RateLimitMiddleware)
      //   router.use(myThrottle)
      // Rate-limit-suggestive identifiers as ARGUMENTS to `.use()` indicate
      // rate limiting is wired in at the router level.
      if (fn?.type === 'member_expression' && fn.childForFieldName('property')?.text === 'use') {
        const args = n.childForFieldName('arguments')
        if (args && hasRateLimitNamedArg(args)) return true
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
 * A middleware variable like `apiV1RateLimitMiddleware`, `myThrottle`,
 * `slowDownAuth` contains a rate-limit-ish substring; treat that name passed
 * into `.use(...)` as proof rate limiting is wired up.
 */
const RATE_LIMIT_NAME_SUBSTRING = /(rate[\s_-]?limit|throttle|slow[\s_-]?down|RateLimiter)/i

function hasRateLimitNamedArg(args: SyntaxNode): boolean {
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i)
    if (arg?.type === 'identifier' && RATE_LIMIT_NAME_SUBSTRING.test(arg.text)) {
      return true
    }
  }
  return false
}

/**
 * Heuristic: a file that constructs a router (`new Hono()`, `express.Router()`,
 * `Router()`) and default-exports it is a sub-router intended to be mounted
 * elsewhere. The mounting site is responsible for rate limiting; flagging the
 * sub-router file is a false positive.
 */
function isMountedSubRouter(root: SyntaxNode): boolean {
  const routerVarNames = new Set<string>()

  function isRouterConstructor(value: SyntaxNode | null): boolean {
    if (!value) return false
    if (value.type === 'new_expression') {
      const constructor = value.childForFieldName('constructor')
      if (constructor?.type === 'identifier' && /^(Hono|Router|App)$/.test(constructor.text)) return true
      if (constructor?.type === 'member_expression' && /^(Hono|Router|App)$/.test(constructor.childForFieldName('property')?.text ?? '')) return true
    }
    if (value.type === 'call_expression') {
      const fn = value.childForFieldName('function')
      if (fn?.type === 'identifier' && /^(Router|express|fastify|Hono)$/i.test(fn.text)) return true
      if (fn?.type === 'member_expression' && /^(Router|router)$/.test(fn.childForFieldName('property')?.text ?? '')) return true
    }
    return false
  }

  function walkDecls(n: SyntaxNode): void {
    if (n.type === 'variable_declarator') {
      const nameNode = n.childForFieldName('name')
      const valueNode = n.childForFieldName('value')
      if (nameNode?.type === 'identifier' && isRouterConstructor(valueNode)) {
        routerVarNames.add(nameNode.text)
      }
    }
    for (const child of n.namedChildren) walkDecls(child)
  }
  walkDecls(root)

  if (routerVarNames.size === 0) return false

  // Look for `export default <routerVar>` at the top level
  for (const child of root.namedChildren) {
    if (child.type !== 'export_statement') continue
    // tree-sitter: export_statement may be `export default X;` — children
    // include `export`, `default`, identifier.
    if (!child.text.startsWith('export default')) continue
    for (let i = 0; i < child.childCount; i++) {
      const part = child.child(i)
      if (part?.type === 'identifier' && routerVarNames.has(part.text)) return true
    }
  }
  return false
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

    // Skip if the file just creates a router and default-exports it — it's a
    // sub-router meant to be mounted by another file, which is the layer that
    // owns rate limiting.
    if (isMountedSubRouter(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'API without rate limiting',
      `Route file uses ${framework} but has no rate limiting middleware. APIs should be rate-limited to prevent abuse.`,
      sourceCode,
      'Add rate limiting middleware (e.g. express-rate-limit, @fastify/rate-limit, hono-rate-limiter).',
    )
  },
}
