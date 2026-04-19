import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isRouteHandler } from './_helpers.js'
import {
  detectWebFramework,
  isAuthMiddlewareName,
} from '../../../_shared/framework-detection.js'

/**
 * Conventional public-route path prefixes that don't need auth.
 * Match by exact path or as a prefix segment (`/login`, `/login/callback`).
 */
const PUBLIC_PATH_PATTERNS = [
  /^\/health(?:\b|\/)/,
  /^\/healthz(?:\b|\/)/,
  /^\/ready(?:\b|\/)/,
  /^\/ping(?:\b|\/)/,
  /^\/metrics(?:\b|\/)/,
  /^\/login(?:\b|\/)/,
  /^\/logout(?:\b|\/)/,
  /^\/signin(?:\b|\/)/,
  /^\/signup(?:\b|\/)/,
  /^\/register(?:\b|\/)/,
  /^\/auth(?:\b|\/)/,
  /^\/webhooks?(?:\b|\/)/,
  /^\/public(?:\b|\/)/,
  /^\/oauth(?:\b|\/)/,
  /^\/callback(?:\b|\/)/,
]

function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((re) => re.test(path))
}

/**
 * Extract identifier names from the middleware arguments to a route definition.
 * Express/Koa/Hono pattern: `app.get('/path', mw1, mw2, handler)`
 * — middleware are args[1..n-2], handler is args[n-1].
 *
 * For inline arrow-function args (the handler), we DON'T treat them as
 * middleware names. Only identifier args count.
 */
function extractMiddlewareNames(callNode: SyntaxNode): string[] {
  const args = callNode.childForFieldName('arguments')
  if (!args) return []
  const all = args.namedChildren
  if (all.length <= 1) return []
  // Handler is the LAST arg; everything between path and handler is middleware
  const middlewareArgs = all.slice(1, -1)
  const names: string[] = []
  for (const arg of middlewareArgs) {
    if (arg.type === 'identifier') {
      names.push(arg.text)
    } else if (arg.type === 'call_expression') {
      // e.g. app.get('/x', authMiddleware(), handler) — extract callee name
      const fn = arg.childForFieldName('function')
      if (fn?.type === 'identifier') names.push(fn.text)
      else if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop) names.push(prop.text)
      }
    } else if (arg.type === 'member_expression') {
      // e.g. passport.authenticate
      const prop = arg.childForFieldName('property')
      if (prop) names.push(prop.text)
    }
  }
  return names
}

/**
 * Walk the program looking for `app.use(...)` calls that register a global
 * auth middleware. If found, ALL routes in this file are protected globally.
 */
function hasGlobalAuthMiddleware(programRoot: SyntaxNode): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object')
        const prop = fn.childForFieldName('property')
        if (
          obj?.type === 'identifier' &&
          /^(app|router|server|fastify)$/i.test(obj.text) &&
          prop?.text === 'use'
        ) {
          // Look at the args of .use(...) — any auth-named identifier counts
          const args = n.childForFieldName('arguments')
          if (args) {
            for (const arg of args.namedChildren) {
              let name = ''
              if (arg.type === 'identifier') name = arg.text
              else if (arg.type === 'call_expression') {
                const innerFn = arg.childForFieldName('function')
                if (innerFn?.type === 'identifier') name = innerFn.text
                else if (innerFn?.type === 'member_expression') {
                  name = innerFn.childForFieldName('property')?.text ?? ''
                }
              }
              if (name && isAuthMiddlewareName(name)) {
                found = true
                return
              }
            }
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child)
  }
  walk(programRoot)
  return found
}

function getProgramRoot(node: SyntaxNode): SyntaxNode {
  let cur = node
  while (cur.parent) cur = cur.parent
  return cur
}

const globalAuthCache = new WeakMap<SyntaxNode, boolean>()

function fileHasGlobalAuthMiddleware(node: SyntaxNode): boolean {
  const root = getProgramRoot(node)
  let cached = globalAuthCache.get(root)
  if (cached === undefined) {
    cached = hasGlobalAuthMiddleware(root)
    globalAuthCache.set(root, cached)
  }
  return cached
}

export const routeWithoutAuthMiddlewareVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/route-without-auth-middleware',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    // Skip if we don't recognize the framework — can't reason about middleware
    // chains we don't understand.
    const framework = detectWebFramework(node)
    if (framework === 'unknown') return null

    // Skip public endpoints by path
    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (firstArg?.type === 'string') {
      const path = firstArg.text.replace(/^['"`]|['"`]$/g, '')
      if (isPublicPath(path)) return null
    }

    // Check this specific route's middleware chain
    const middleware = extractMiddlewareNames(node)
    if (middleware.some(isAuthMiddlewareName)) return null

    // Check if the file has a global auth middleware applied via app.use(...)
    if (fileHasGlobalAuthMiddleware(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route without auth middleware',
      `Route handler has no authentication middleware (${framework}). Add auth middleware or mark the route as public.`,
      sourceCode,
      'Add auth middleware to the route, app.use() it globally, or move the route to a clearly-public path.',
    )
  },
}
