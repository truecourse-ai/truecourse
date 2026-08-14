import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RouteRegistration, RouterMount, SupportedLanguage } from '@truecourse/shared'
import { extractPythonRoutes } from './routes/python.js'
import { extractCSharpRoutes } from './routes/csharp.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all'])

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

  const cursor = tree.walk()

  function traverse(): void {
    if (cursor.nodeType === 'call_expression') {
      const node = cursor.currentNode
      const calleeNode = node.childForFieldName('function')
      const argsNode = node.childForFieldName('arguments')

      if (calleeNode && argsNode && calleeNode.type === 'member_expression') {
        const property = calleeNode.childForFieldName('property')
        if (!property) {
          if (cursor.gotoFirstChild()) {
            do { traverse() } while (cursor.gotoNextSibling())
            cursor.gotoParent()
          }
          return
        }

        const methodName = property.text

        if (methodName === 'use') {
          // app.use('/prefix', ...middleware, routerRef)
          mounts.push(...extractMounts(argsNode, filePath, node))
        } else if (HTTP_METHODS.has(methodName)) {
          // router.get('/path', ...middleware, handler)
          const route = extractRoute(methodName, argsNode, filePath, node)
          if (route) routes.push(route)
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
  if (!path) return null

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
  if (!path) return []

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

function extractStringLiteral(node: SyntaxNode): string | null {
  if (node.type === 'string' || node.type === 'string_fragment') {
    return node.text.replace(/^["'`]|["'`]$/g, '')
  }
  return null
}

