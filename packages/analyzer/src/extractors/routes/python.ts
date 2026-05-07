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

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RouteRegistration, RouterMount } from '@truecourse/shared'

export function extractPythonRoutes(
  tree: Tree,
  filePath: string,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  const routes: RouteRegistration[] = []
  const mounts: RouterMount[] = []

  function traverse(node: SyntaxNode): void {
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

// Frameworks that register handlers via decorator. The route's
// HTTP method may not be meaningful (MCP `tool`, Slack `event`,
// Click `command`, etc.) but the handler-name binding is — the
// architecture checker uses route handler names to skip the
// dead-method / unused-export rules. Coerce non-HTTP framework
// decorators to httpMethod='ALL' so the entry still tracks the
// handler.
const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'route'])
const FRAMEWORK_HANDLER_DECORATORS = new Set([
  // FastAPI / Flask shorthand HTTP verbs handled by HTTP_VERBS above.
  // MCP: @mcp_server.tool() / @mcp_server.resource() / @mcp_server.prompt()
  'tool', 'resource', 'prompt',
  // Slack Bolt / general event-driven decorators
  'event', 'message', 'command', 'shortcut', 'action', 'view', 'options',
  // Click CLI
  'group',
  // Celery / RQ
  'task', 'periodic_task',
  // FastAPI app lifecycle
  'on_event', 'middleware',
])

function extractDecoratorRoute(
  decorator: SyntaxNode,
  definition: SyntaxNode,
  filePath: string,
): RouteRegistration | null {
  const decoratorText = decorator.text

  const methodMatch = decoratorText.match(/@\w+\.(\w+)\s*\(/)
  if (!methodMatch) return null
  const decoratorMethod = methodMatch[1]
  const isHttp = HTTP_VERBS.has(decoratorMethod)
  const isFrameworkHandler = FRAMEWORK_HANDLER_DECORATORS.has(decoratorMethod)
  if (!isHttp && !isFrameworkHandler) return null

  let method: string
  if (isHttp) {
    method = decoratorMethod.toUpperCase()
    if (method === 'ROUTE') {
      const methodsMatch = decoratorText.match(/methods\s*=\s*\[\s*['"](\w+)['"]/)
      method = methodsMatch ? methodsMatch[1].toUpperCase() : 'GET'
    }
  } else {
    method = 'ALL' // non-HTTP framework handler
  }

  // Path is required for HTTP routes; framework handlers may have no path
  // (MCP @tool(), @on_event('startup')). Provide a placeholder when missing
  // so the handler-name binding still propagates to the architecture checker.
  const pathMatch = decoratorText.match(/\(\s*['"]([^'"]+)['"]/)
  const routePath = pathMatch ? pathMatch[1] : `__decorated_${decoratorMethod}__`

  let handlerName: string | null = null
  for (const child of definition.namedChildren) {
    if (child.type === 'function_definition') {
      handlerName = child.childForFieldName('name')?.text || null
      break
    }
  }

  return {
    httpMethod: method as RouteRegistration['httpMethod'],
    path: routePath,
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
  callNode: SyntaxNode,
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
  outerCall: SyntaxNode,
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
