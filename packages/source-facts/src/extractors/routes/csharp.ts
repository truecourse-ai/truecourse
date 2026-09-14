/**
 * C# route extraction — ASP.NET Core attribute routing + minimal APIs.
 *
 * Detects:
 *   [ApiController] + [Route("api/[controller]")] class prefixes (with
 *   [controller]/[action] token substitution)
 *   [HttpGet("{id}")], [HttpPost], … method attributes
 *   app.MapGet("/path", handler) minimal APIs
 *   var group = app.MapGroup("/prefix"); group.MapGet("{id}", …) groups
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RouteRegistration, RouterMount } from '@truecourse/shared'

const HTTP_METHOD_ATTRIBUTES: Record<string, RouteRegistration['httpMethod']> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpDelete: 'DELETE',
  HttpPatch: 'PATCH',
}

const MINIMAL_API_METHODS: Record<string, RouteRegistration['httpMethod']> = {
  MapGet: 'GET',
  MapPost: 'POST',
  MapPut: 'PUT',
  MapDelete: 'DELETE',
  MapPatch: 'PATCH',
}

export function extractCSharpRoutes(
  tree: Tree,
  filePath: string,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  const routes: RouteRegistration[] = []
  const mounts: RouterMount[] = []

  // Pre-pass: MapGroup prefixes — `var customers = app.MapGroup("/api/customers")`
  const groupPrefixes = collectGroupPrefixes(tree.rootNode)

  function traverse(node: SyntaxNode, classContext: { prefix: string; controllerToken: string } | null): void {
    if (node.type === 'class_declaration') {
      const className = node.childForFieldName('name')?.text ?? ''
      const prefix = extractClassRoutePrefix(node)
      const controllerToken = className.replace(/Controller$/, '').toLowerCase()
      for (const child of node.namedChildren) {
        if (child) traverse(child, { prefix, controllerToken })
      }
      return
    }

    if (node.type === 'method_declaration' && classContext) {
      const route = extractAttributeRoute(node, filePath, classContext)
      if (route) routes.push(route)
    }

    if (node.type === 'invocation_expression') {
      const route = extractMinimalApiRoute(node, filePath, groupPrefixes)
      if (route) routes.push(route)
    }

    for (const child of node.namedChildren) {
      if (child) traverse(child, classContext)
    }
  }

  traverse(tree.rootNode, null)
  return { routes, mounts }
}

/** Collect `var x = app.MapGroup("/prefix")` variable → prefix bindings. */
function collectGroupPrefixes(root: SyntaxNode): Map<string, string> {
  const prefixes = new Map<string, string>()

  function walk(node: SyntaxNode) {
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')?.text ?? node.namedChildren[0]?.text
      // The initializer follows the `=` token
      for (const child of node.namedChildren) {
        if (!child || child.type !== 'invocation_expression') continue
        const fn = child.childForFieldName('function')
        if (fn?.type === 'member_access_expression' && fn.childForFieldName('name')?.text === 'MapGroup') {
          const args = child.childForFieldName('arguments')
          const path = args ? extractFirstStringArg(args) : null
          if (name && path) {
            // Nested groups: prefix of the receiver group composes
            const receiver = fn.childForFieldName('expression')?.text ?? ''
            const parentPrefix = prefixes.get(receiver) ?? ''
            prefixes.set(name, joinRoute(parentPrefix, path))
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      if (child) walk(child)
    }
  }

  walk(root)
  return prefixes
}

/** The [Route("…")] prefix on a class declaration. */
function extractClassRoutePrefix(classNode: SyntaxNode): string {
  for (const child of classNode.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      if (attr.childForFieldName('name')?.text !== 'Route') continue
      const args = childOfType(attr, 'attribute_argument_list')
      if (args) {
        const path = extractFirstStringArg(args)
        if (path) return path
      }
    }
  }
  return ''
}

function extractAttributeRoute(
  methodNode: SyntaxNode,
  filePath: string,
  classContext: { prefix: string; controllerToken: string },
): RouteRegistration | null {
  let httpMethod: RouteRegistration['httpMethod'] | null = null
  let routePath = ''

  for (const child of methodNode.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const name = attr.childForFieldName('name')?.text
      if (!name) continue

      const method = HTTP_METHOD_ATTRIBUTES[name]
      if (method) {
        httpMethod = method
        const args = childOfType(attr, 'attribute_argument_list')
        if (args) {
          const path = extractFirstStringArg(args)
          if (path) routePath = path
        }
      } else if (name === 'Route' && !routePath) {
        // [Route("…")] on the method combines with an Http* attribute
        const args = childOfType(attr, 'attribute_argument_list')
        if (args) {
          const path = extractFirstStringArg(args)
          if (path) routePath = path
        }
      }
    }
  }

  if (!httpMethod) return null

  const handlerName = methodNode.childForFieldName('name')?.text || 'anonymous'

  // Absolute method routes (leading /) replace the class prefix
  let fullPath = routePath.startsWith('/') ? routePath : joinRoute(classContext.prefix, routePath)

  // ASP.NET route tokens
  fullPath = fullPath
    .replace(/\[controller\]/gi, classContext.controllerToken)
    .replace(/\[action\]/gi, handlerName.toLowerCase())

  if (!fullPath.startsWith('/')) fullPath = '/' + fullPath
  if (fullPath !== '/') fullPath = fullPath.replace(/\/$/, '')

  return {
    httpMethod,
    path: fullPath,
    handlerName,
    location: location(methodNode, filePath),
  }
}

function extractMinimalApiRoute(
  callNode: SyntaxNode,
  filePath: string,
  groupPrefixes: Map<string, string>,
): RouteRegistration | null {
  const funcNode = callNode.childForFieldName('function')
  if (!funcNode || funcNode.type !== 'member_access_expression') return null

  const methodName = funcNode.childForFieldName('name')?.text
  if (!methodName) return null

  const httpMethod = MINIMAL_API_METHODS[methodName]
  if (!httpMethod) return null

  const argsNode = callNode.childForFieldName('arguments')
  if (!argsNode) return null

  const path = extractFirstStringArg(argsNode)
  if (path === null) return null

  // Group prefix from the receiver: customers.MapGet(…)
  const receiver = funcNode.childForFieldName('expression')?.text ?? ''
  const prefix = groupPrefixes.get(receiver) ?? ''

  let fullPath = joinRoute(prefix, path)
  if (!fullPath.startsWith('/')) fullPath = '/' + fullPath

  // Handler name from the second argument (method group or member access)
  let handlerName = 'anonymous'
  const args = argsNode.namedChildren.filter(Boolean)
  if (args.length >= 2) {
    const handlerArg = args[1]!.type === 'argument' ? args[1]!.namedChildren[0] : args[1]
    if (handlerArg?.type === 'identifier') {
      handlerName = handlerArg.text
    } else if (handlerArg?.type === 'member_access_expression') {
      handlerName = handlerArg.childForFieldName('name')?.text ?? 'anonymous'
    }
  }

  return {
    httpMethod,
    path: fullPath,
    handlerName,
    location: location(callNode, filePath),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function childOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.children) {
    if (child && child.type === type) return child
  }
  return null
}

function joinRoute(prefix: string, path: string): string {
  const p = prefix.replace(/\/$/, '')
  const s = path.replace(/^\//, '')
  if (!p) return path
  if (!s) return p
  return `${p}/${s}`
}

/** First string-literal argument: "api/orders", @"…", or $"…" (kept raw). */
function extractFirstStringArg(argsNode: SyntaxNode): string | null {
  for (const child of argsNode.namedChildren) {
    if (!child) continue
    // Call args wrap in `argument`, attribute args in `attribute_argument`
    const candidate =
      child.type === 'argument' || child.type === 'attribute_argument' ? child.namedChildren[0] : child
    if (!candidate) continue
    if (candidate.type === 'string_literal' || candidate.type === 'verbatim_string_literal' || candidate.type === 'interpolated_string_expression') {
      return candidate.text.replace(/^[@$]*"|"$/g, '')
    }
  }
  return null
}

function location(node: SyntaxNode, filePath: string) {
  return {
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  }
}
