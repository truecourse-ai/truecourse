import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RouteRegistration, RouterMount, SupportedLanguage } from '@truecourse/shared'
import { extractPythonRoutes } from './routes/python.js'
import { extractCSharpRoutes } from './routes/csharp.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all'])

// ---------------------------------------------------------------------------
// The receiver gate
//
// `<receiver>.<method>('<string>', …, <handler-ish>)` is not a route
// registration on its own — it is one of the most common call shapes in
// JavaScript. Measured on strapi, an ungated match derived 107 API "endpoints",
// not one of which was a route: MSW mocks (`http.get('*/a-pdf.pdf', () => …)`),
// config reads (`strapi.config.get('admin.auth.sessions.idle', DEFAULT)`),
// and http clients (`axios.get('/api/users', { params })`) all fit it exactly.
//
// The gate is two independent invariants, both required:
//
//  1. The path literal must be a route path — it starts with `/`, or it is the
//     bare Express catch-all `*`. This is free and it kills every dotted config
//     key and every MSW glob. It is necessary but nowhere near sufficient:
//     `http.get('/admin/roles/1', …)` is a mock and passes it.
//
//  2. The receiver must be router-like IN THIS FILE. Deliberately not a
//     blocklist of library names (`http`, `config`, `axios`, …) — that loses to
//     the next library published. Instead the receiver has to earn it, three
//     ways, any one sufficient:
//       a. it is bound to a server/router constructor here
//          (`express()`, `express.Router()`, `new Hono()`, `fastify()`);
//       b. it is named the way the ecosystem names routers — `app`, `router`,
//          `routes`, `server`, or a camelCase word ending in one of those
//          (`todosRouter`, `userRoutes`, `adminApp`). This is what carries the
//          extremely common cases the extractor cannot resolve: a router
//          imported from another module, and a router received as a parameter
//          (`export function register(app) { app.get(…) }`);
//       c. the file calls `.listen(…)` on it — only a server does that.
//
// `.use(…)` is deliberately NOT evidence for a MOUNT, because `.use` is the
// very call a mount is extracted from: letting it vouch for its own receiver
// would make every `i18n.use(plugin)` in the repo a router mount. It DOES
// vouch for a sibling HTTP-method call on the same receiver, where it is
// independent evidence — that asymmetry is the `allowUse` flag below.
//
// The receiver is read down to its last segment, so `this.app.get(…)` is a
// route and `strapi.config.get(…)` is not. And when the receiver is itself a
// call — the chained-builder style every modern router is written in,
// `new Hono().get('/a', h).post('/b', h)` — the chain is walked back to its HEAD
// and judged there, so each link inherits what the head earned. Without that
// walk only the innermost link survives, which cost 36 real registrations in
// documenso. The walk cannot readmit `axios.create().get('/api/users', …)`: it
// is the same shape, but its head is `axios`, which earns nothing by any of the
// three routes above.
// ---------------------------------------------------------------------------

/**
 * Callee tail names that construct a server or router in the mainstream Node
 * HTTP frameworks. Matched on the TAIL so `Router()`, `express.Router()` and
 * `new Hono()` are one rule.
 */
const ROUTER_CONSTRUCTORS = new Set([
  'express',
  'Router',
  'router',
  'createRouter',
  'fastify',
  'Fastify',
  'Koa',
  'Hono',
  'polka',
  'connect',
  'restify',
  'createServer',
  'createApp',
  'Elysia',
])

/** `app`, `router`, `routes`, `server`, or a camelCase word ending in one. */
const ROUTER_NAME = /^(app|router|routes|server)$|(App|Router|Routes|Server)$/

/** Methods whose receiver can only be a server. */
const SERVER_ONLY_METHODS = new Set(['listen'])

/**
 * Router-likeness signals collected in one pass over the file, before any
 * registration is extracted. `strong` gates both routes and mounts; `viaUse`
 * gates routes only (see the module note on `.use`).
 */
interface ReceiverEvidence {
  strong: Set<string>
  viaUse: Set<string>
}

/**
 * Extract route registrations and router mounts from source files.
 * Dispatches to language-specific extractors.
 */
export function extractRouteRegistrations(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  switch (language) {
    case 'python':
      return extractPythonRoutes(tree, filePath)
    case 'csharp':
      return extractCSharpRoutes(tree, filePath)
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return extractJsRoutes(tree, filePath)
    default:
      return { routes: [], mounts: [] }
  }
}

function extractJsRoutes(
  tree: Tree,
  filePath: string,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  const routes: RouteRegistration[] = []
  const mounts: RouterMount[] = []

  const evidence = collectReceiverEvidence(tree)
  const cursor = tree.walk()

  function traverse(): void {
    if (cursor.nodeType === 'call_expression') {
      const node = cursor.currentNode
      const calleeNode = node.childForFieldName('function')
      const argsNode = node.childForFieldName('arguments')

      if (calleeNode && argsNode && calleeNode.type === 'member_expression') {
        const property = calleeNode.childForFieldName('property')
        const receiver = calleeNode.childForFieldName('object')
        if (!property || !receiver) {
          if (cursor.gotoFirstChild()) {
            do { traverse() } while (cursor.gotoNextSibling())
            cursor.gotoParent()
          }
          return
        }

        const methodName = property.text

        if (methodName === 'use') {
          // app.use('/prefix', ...middleware, routerRef)
          if (isRouterLikeReceiver(receiver, evidence, false)) {
            mounts.push(...extractMounts(argsNode, filePath, node))
          }
        } else if (HTTP_METHODS.has(methodName)) {
          // router.get('/path', ...middleware, handler)
          if (isRouterLikeReceiver(receiver, evidence, true)) {
            const route = extractRoute(methodName, argsNode, filePath, node)
            if (route) routes.push(route)
          }
        }
      }
    }

    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return { routes, mounts }
}

/**
 * One pass over the file collecting which identifiers behave like a router or a
 * server here — see the module note for why this exists and why it is not a
 * blocklist.
 */
function collectReceiverEvidence(tree: Tree): ReceiverEvidence {
  const strong = new Set<string>()
  const viaUse = new Set<string>()
  const cursor = tree.walk()

  function record(nameNode: SyntaxNode | null, valueNode: SyntaxNode | null): void {
    if (!nameNode || !valueNode || nameNode.type !== 'identifier') return
    // Read through the chain, so `const authRoute = new Hono().basePath('/auth')`
    // binds `authRoute` just as `const app = new Hono()` binds `app`.
    if (isConstructedRouter(chainHead(valueNode))) strong.add(nameNode.text)
  }

  function traverse(): void {
    const node = cursor.currentNode

    if (node.type === 'variable_declarator') {
      record(node.childForFieldName('name'), node.childForFieldName('value'))
    } else if (node.type === 'assignment_expression') {
      record(node.childForFieldName('left'), node.childForFieldName('right'))
    } else if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      if (callee && callee.type === 'member_expression') {
        const property = callee.childForFieldName('property')
        const receiver = callee.childForFieldName('object')
        const name = receiver ? receiverName(receiver) : null
        if (property && name) {
          if (SERVER_ONLY_METHODS.has(property.text)) strong.add(name)
          else if (property.text === 'use') viaUse.add(name)
        }
      }
    }

    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return { strong, viaUse }
}

/**
 * `allowUse` — whether `.use(…)` on this receiver counts as evidence. False when
 * gating a mount, which IS a `.use` call and so cannot be its own witness.
 */
function isRouterLikeReceiver(
  receiver: SyntaxNode,
  evidence: ReceiverEvidence,
  allowUse: boolean,
): boolean {
  const head = chainHead(receiver)

  // `express.Router().get('/x', h)` — constructed inline, nothing to name.
  if (isConstructedRouter(head)) return true

  const name = receiverName(head)
  if (!name) return false
  if (evidence.strong.has(name)) return true
  if (allowUse && evidence.viaUse.has(name)) return true
  return ROUTER_NAME.test(name)
}

/**
 * The head of a method chain — what the chain was BUILT FROM:
 * `new Hono().get('/a', h).post('/b', h)` → `new Hono()`,
 * `axios.create().get('/api/users', …)` → `axios`.
 *
 * Walks back through method calls (`<x>.m(…)`) only, and stops the moment it
 * reaches a constructed router, so `express.Router()` is a head rather than
 * being read through to the `express` namespace behind it. Anything that is not
 * a method call is already the head, which leaves a plain call
 * (`setupServer()`, `makeClient()`) unnamed and therefore rejected.
 *
 * Every hop strictly descends the tree, so this terminates.
 */
function chainHead(node: SyntaxNode): SyntaxNode {
  let current = node
  for (;;) {
    if (isConstructedRouter(current)) return current
    if (current.type !== 'call_expression') return current
    const callee = current.childForFieldName('function')
    if (!callee || callee.type !== 'member_expression') return current
    const object = callee.childForFieldName('object')
    if (!object) return current
    current = object
  }
}

/** The last segment of a receiver: `app` → `app`, `this.app` → `app`, `strapi.config` → `config`. */
function receiverName(receiver: SyntaxNode): string | null {
  if (receiver.type === 'identifier') return receiver.text
  if (receiver.type === 'member_expression') {
    return receiver.childForFieldName('property')?.text ?? null
  }
  return null
}

function isConstructedRouter(node: SyntaxNode): boolean {
  if (node.type !== 'call_expression' && node.type !== 'new_expression') return false
  const callee = node.childForFieldName('function') ?? node.childForFieldName('constructor')
  if (!callee) return false
  const tail =
    callee.type === 'member_expression'
      ? callee.childForFieldName('property')?.text
      : callee.type === 'identifier'
        ? callee.text
        : undefined
  return tail !== undefined && ROUTER_CONSTRUCTORS.has(tail)
}

/**
 * A route path always starts with `/`. The one exception is Express's bare `*`
 * catch-all — which is a real registration, so it is kept here and dropped
 * later by whoever cares (the api derivation skips catch-alls).
 */
function isRoutePath(path: string): boolean {
  return path === '*' || path.startsWith('/')
}

function extractRoute(
  methodName: string,
  argsNode: SyntaxNode,
  filePath: string,
  callNode: SyntaxNode,
): RouteRegistration | null {
  // First arg must be a string path
  const firstArg = argsNode.namedChild(0)
  if (!firstArg) return null

  const path = extractStringLiteral(firstArg)
  if (!path || !isRoutePath(path)) return null

  // Last named arg is the handler (skips middleware)
  const argCount = argsNode.namedChildCount
  if (argCount < 2) return null

  const lastArg = argsNode.namedChild(argCount - 1)
  if (!lastArg) return null

  const handlerName = extractHandlerName(lastArg)
  if (handlerName === null) return null

  return {
    httpMethod: methodName.toUpperCase() as RouteRegistration['httpMethod'],
    path,
    handlerName,
    location: {
      filePath,
      startLine: callNode.startPosition.row + 1,
      endLine: callNode.endPosition.row + 1,
      startColumn: callNode.startPosition.column,
      endColumn: callNode.endPosition.column,
    },
  }
}

/**
 * `app.use('/prefix', ...middleware, routerRef)` — every named argument after the
 * path is mounted AT that path by Express, so every identifier among them is a
 * candidate router and each becomes its own mount. Reading only the argument
 * right after the path misses the mainstream layout, where a resolver or an auth
 * guard sits between the prefix and the router
 * (`app.use('/api/repos', projectResolver, analysesRouter)`).
 *
 * The extractor is per-file and the identifiers are usually imported, so it
 * cannot tell a router from a middleware here — it emits candidates. A consumer
 * holding the whole tree (`buildMountPrefixes`) resolves each one and drops the
 * ones that are not routers.
 */
function extractMounts(
  argsNode: SyntaxNode,
  filePath: string,
  callNode: SyntaxNode,
): RouterMount[] {
  // Need at least 2 args: path string + identifier
  if (argsNode.namedChildCount < 2) return []

  const firstArg = argsNode.namedChild(0)
  if (!firstArg) return []

  const path = extractStringLiteral(firstArg)
  if (!path || !isRoutePath(path)) return []

  const location = {
    filePath,
    startLine: callNode.startPosition.row + 1,
    endLine: callNode.endPosition.row + 1,
    startColumn: callNode.startPosition.column,
    endColumn: callNode.endPosition.column,
  }

  const mounts: RouterMount[] = []
  for (let i = 1; i < argsNode.namedChildCount; i++) {
    const arg = argsNode.namedChild(i)
    if (!arg) continue
    const routerName = extractIdentifierName(arg)
    if (!routerName) continue
    mounts.push({ path, routerName, location })
  }
  return mounts
}

/**
 * Extract the handler name from the last argument of a route registration.
 * Handles: identifier, member_expression (obj.method), a wrapper call's inner
 * handler (`asyncHandler(getTodos)`), and inline arrow/function expressions —
 * which register with an EMPTY name: the route is the app's surface whether or
 * not its handler has a symbol, and dropping it would hide the endpoint from
 * every route consumer (flows, interfaces, architecture rules). `null` means the
 * argument is not a handler shape at all (the call is not a route registration).
 */
function extractHandlerName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') {
    return node.text
  }

  if (node.type === 'member_expression') {
    const property = node.childForFieldName('property')
    if (property) return property.text
  }

  // asyncHandler(getTodos) — attribute to the wrapped handler when it is named.
  if (node.type === 'call_expression') {
    const inner = node.childForFieldName('arguments')?.namedChild(0)
    if (inner && (inner.type === 'identifier' || inner.type === 'member_expression')) {
      return extractHandlerName(inner)
    }
    return ''
  }

  if (
    node.type === 'arrow_function' ||
    node.type === 'function_expression' ||
    node.type === 'function' ||
    node.type === 'generator_function'
  ) {
    return ''
  }

  return null
}

function extractIdentifierName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  return null
}

/**
 * The statically-known text of a path argument, or `null` when there is none.
 *
 * A backtick string counts — `app.get(\`/api/v2/openapi.json\`, …)` registers
 * exactly the route the quoted form would. But only when it is FREE of `${…}`:
 * `\`/users/${id}\`` is not a statically-known path, and a half-guessed one
 * (`/users/`) would be worse than no route at all, so it is skipped. Anything
 * other than plain text inside the backticks — an interpolation, an escape —
 * disqualifies it.
 */
function extractStringLiteral(node: SyntaxNode): string | null {
  if (node.type === 'string' || node.type === 'string_fragment') {
    return node.text.replace(/^["'`]|["'`]$/g, '')
  }

  if (node.type === 'template_string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i)?.type !== 'string_fragment') return null
    }
    return node.text.replace(/^`|`$/g, '')
  }

  return null
}

