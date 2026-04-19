import type { Node as SyntaxNode } from 'web-tree-sitter'

export const EXPRESS_ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'use', 'all'])

export function isRouteHandler(node: SyntaxNode): boolean {
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'member_expression') return false

  const prop = fn.childForFieldName('property')
  if (!prop || !EXPRESS_ROUTE_METHODS.has(prop.text)) return false

  const obj = fn.childForFieldName('object')
  if (!obj) return false
  const objName = obj.text
  return objName === 'app' || objName === 'router' || objName === 'route'
}

export function getHandlerFromRouteCall(node: SyntaxNode): SyntaxNode | null {
  const args = node.childForFieldName('arguments')
  if (!args) return null
  const lastArg = args.namedChildren[args.namedChildren.length - 1]
  if (!lastArg) return null
  if (lastArg.type === 'arrow_function' || lastArg.type === 'function') {
    return lastArg
  }
  return null
}
