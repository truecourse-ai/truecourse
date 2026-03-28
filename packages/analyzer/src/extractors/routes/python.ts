/**
 * Python route extraction — Flask, FastAPI, Django.
 *
 * Detects:
 *   @app.route('/path', methods=['GET'])
 *   @bp.get('/path')
 *   app.register_blueprint(bp, url_prefix='/prefix')
 *   app.include_router(router, prefix='/prefix')
 *   bp.route("/path", methods=["GET"])(handler)
 */

import type Parser from 'tree-sitter'
import type { RouteRegistration, RouterMount } from '@truecourse/shared'

export function extractPythonRoutes(
  tree: Parser.Tree,
  filePath: string,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  const routes: RouteRegistration[] = []
  const mounts: RouterMount[] = []

  function traverse(node: Parser.SyntaxNode): void {
    // Decorator-based routes: @app.get('/path') or @bp.route('/path')
    if (node.type === 'decorated_definition') {
      for (const child of node.children) {
        if (child.type === 'decorator') {
          const route = extractDecoratorRoute(child, node, filePath)
          if (route) routes.push(route)
        }
      }
    }

    // Blueprint/router mounts and programmatic route binding
    if (node.type === 'call') {
      const funcNode = node.childForFieldName('function')
      if (funcNode?.type === 'attribute') {
        const methodName = funcNode.childForFieldName('attribute')?.text
        if (methodName === 'register_blueprint' || methodName === 'include_router') {
          const mount = extractRouterMount(node, filePath)
          if (mount) mounts.push(mount)
        }
      }

      // Chained call: bp.route("/path", methods=["GET"])(handler_func)
      if (funcNode?.type === 'call') {
        const route = extractChainedRoute(node, filePath)
        if (route) routes.push(route)
      }
    }

    for (const child of node.namedChildren) {
      traverse(child)
    }
  }

  traverse(tree.rootNode)
  return { routes, mounts }
}

function extractDecoratorRoute(
  decorator: Parser.SyntaxNode,
  definition: Parser.SyntaxNode,
  filePath: string,
): RouteRegistration | null {
  const decoratorText = decorator.text

  const methodMatch = decoratorText.match(/@\w+\.(get|post|put|delete|patch|route)\s*\(/)
  if (!methodMatch) return null

  let method = methodMatch[1].toUpperCase()
  if (method === 'ROUTE') {
    const methodsMatch = decoratorText.match(/methods\s*=\s*\[\s*['"](\w+)['"]/)
    method = methodsMatch ? methodsMatch[1].toUpperCase() : 'GET'
  }

  const pathMatch = decoratorText.match(/\(\s*['"]([^'"]+)['"]/)
  if (!pathMatch) return null

  let handlerName: string | null = null
  for (const child of definition.namedChildren) {
    if (child.type === 'function_definition') {
      handlerName = child.childForFieldName('name')?.text || null
      break
    }
  }

  return {
    httpMethod: method as RouteRegistration['httpMethod'],
    path: pathMatch[1],
    handlerName: handlerName || 'anonymous',
    location: {
      filePath,
      startLine: decorator.startPosition.row + 1,
      endLine: decorator.endPosition.row + 1,
      startColumn: decorator.startPosition.column,
      endColumn: decorator.endPosition.column,
    },
  }
}

function extractRouterMount(
  callNode: Parser.SyntaxNode,
  filePath: string,
): RouterMount | null {
  const argsNode = callNode.childForFieldName('arguments')
  if (!argsNode) return null

  const args = argsNode.namedChildren
  if (args.length === 0) return null

  const routerName = args[0]?.type === 'identifier' ? args[0].text : null
  if (!routerName) return null

  let path = '/'
  for (const arg of args) {
    if (arg.type === 'keyword_argument') {
      const key = arg.childForFieldName('name')?.text
      const value = arg.childForFieldName('value')
      if ((key === 'url_prefix' || key === 'prefix') && value) {
        path = value.text.replace(/^["']|["']$/g, '')
      }
    }
  }

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

function extractChainedRoute(
  outerCall: Parser.SyntaxNode,
  filePath: string,
): RouteRegistration | null {
  const innerCall = outerCall.childForFieldName('function')
  if (!innerCall || innerCall.type !== 'call') return null

  const innerFunc = innerCall.childForFieldName('function')
  if (!innerFunc || innerFunc.type !== 'attribute') return null

  const methodName = innerFunc.childForFieldName('attribute')?.text
  if (methodName !== 'route' && methodName !== 'get' && methodName !== 'post'
    && methodName !== 'put' && methodName !== 'delete' && methodName !== 'patch') return null

  const innerArgs = innerCall.childForFieldName('arguments')
  if (!innerArgs) return null

  let path: string | null = null
  let httpMethod = methodName === 'route' ? 'GET' : methodName.toUpperCase()

  for (const arg of innerArgs.namedChildren) {
    if (!path && arg.type === 'string') {
      path = arg.text.replace(/^["']|["']$/g, '')
    }
    if (arg.type === 'keyword_argument') {
      const key = arg.childForFieldName('name')?.text
      const value = arg.childForFieldName('value')
      if (key === 'methods' && value) {
        const methodsMatch = value.text.match(/['"](\w+)['"]/)
        if (methodsMatch) httpMethod = methodsMatch[1].toUpperCase()
      }
    }
  }

  if (!path) return null

  const outerArgs = outerCall.childForFieldName('arguments')
  const handlerArg = outerArgs?.namedChildren[0]
  const handlerName = handlerArg?.type === 'identifier' ? handlerArg.text : 'anonymous'

  return {
    httpMethod: httpMethod as RouteRegistration['httpMethod'],
    path,
    handlerName,
    location: {
      filePath,
      startLine: outerCall.startPosition.row + 1,
      endLine: outerCall.endPosition.row + 1,
      startColumn: outerCall.startPosition.column,
      endColumn: outerCall.endPosition.column,
    },
  }
}
