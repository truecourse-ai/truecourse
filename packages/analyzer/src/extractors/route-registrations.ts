import type Parser from 'tree-sitter'
import type { RouteRegistration, RouterMount, SupportedLanguage } from '@truecourse/shared'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all'])

/**
 * Extract route registrations and router mounts from an Express-style file.
 *
 * Detects patterns like:
 *   router.get('/users', handler)
 *   router.get('/users', mw1, mw2, handler)
 *   app.use('/prefix', routerRef)
 */
export function extractRouteRegistrations(
  tree: Parser.Tree,
  filePath: string,
  language: SupportedLanguage,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  const routes: RouteRegistration[] = []
  const mounts: RouterMount[] = []

  if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') {
    return { routes, mounts }
  }

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
          // app.use('/prefix', routerRef)
          const mount = extractMount(argsNode, filePath, node)
          if (mount) mounts.push(mount)
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
  argsNode: Parser.SyntaxNode,
  filePath: string,
  callNode: Parser.SyntaxNode,
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
  if (!handlerName) return null

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

function extractMount(
  argsNode: Parser.SyntaxNode,
  filePath: string,
  callNode: Parser.SyntaxNode,
): RouterMount | null {
  // app.use('/prefix', routerRef)
  // Need at least 2 args: path string + identifier
  if (argsNode.namedChildCount < 2) return null

  const firstArg = argsNode.namedChild(0)
  if (!firstArg) return null

  const path = extractStringLiteral(firstArg)
  if (!path) return null

  const secondArg = argsNode.namedChild(1)
  if (!secondArg) return null

  // The router argument should be an identifier
  const routerName = extractIdentifierName(secondArg)
  if (!routerName) return null

  return {
    path,
    routerName,
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
 * Extract the handler name from the last argument of a route registration.
 * Handles: identifier, member_expression (obj.method), arrow functions (skip).
 */
function extractHandlerName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'identifier') {
    return node.text
  }

  if (node.type === 'member_expression') {
    const property = node.childForFieldName('property')
    if (property) return property.text
  }

  // Arrow functions / function expressions are anonymous — skip
  return null
}

function extractIdentifierName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  return null
}

function extractStringLiteral(node: Parser.SyntaxNode): string | null {
  if (node.type === 'string' || node.type === 'string_fragment') {
    return node.text.replace(/^["'`]|["'`]$/g, '')
  }
  return null
}
