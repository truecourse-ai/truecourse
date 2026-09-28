/**
 * TanStack file route IDs and whether their options declare a component.
 * Only calls through an imported runtime factory count. The mapper turns IDs
 * into addresses; pathless layout and group segments are not URL segments.
 */
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { ImportStatement, TanStackRoute } from '@truecourse/shared'

const FACTORIES = new Set(['createFileRoute', 'createLazyFileRoute'])

export function extractTanStackRoutes(
  tree: Tree,
  filePath: string,
  imports: readonly ImportStatement[],
): TanStackRoute[] {
  const factories = new Set<string>()
  for (const imp of imports) {
    if (imp.isTypeOnly || !/^@tanstack\/(?:[a-z]+-router|react-start)$/.test(imp.source)) continue
    for (const spec of imp.specifiers) {
      if (spec.isNamespace) {
        for (const name of FACTORIES) factories.add(`${spec.alias ?? spec.name}.${name}`)
      } else if (FACTORIES.has(spec.name)) {
        factories.add(spec.alias ?? spec.name)
      }
    }
  }
  if (!factories.size) return []

  const routes: TanStackRoute[] = []
  function visit(node: SyntaxNode): void {
    if (node.type === 'call_expression') {
      const factory = node.childForFieldName('function')
      if (factory?.type === 'call_expression' && factories.has(factory.childForFieldName('function')?.text ?? '')) {
        const id = factory.childForFieldName('arguments')?.namedChild(0)
        const options = node.childForFieldName('arguments')?.namedChild(0)
        if (id?.type === 'string' && options?.type === 'object') {
          const routeId = id.text.slice(1, -1)
          if (routeId.startsWith('/')) {
            routes.push({
              routeId,
              hasComponent: options.namedChildren.some(isComponent),
              location: {
                filePath,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startColumn: node.startPosition.column,
                endColumn: node.endPosition.column,
              },
            })
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(tree.rootNode)
  return routes
}

function isComponent(node: SyntaxNode): boolean {
  if (node.type === 'shorthand_property_identifier') return node.text === 'component'
  if (node.type === 'method_definition') return node.childForFieldName('name')?.text === 'component'
  if (node.type !== 'pair') return false
  const key = node.childForFieldName('key')?.text.replace(/^['"]|['"]$/g, '')
  const value = node.childForFieldName('value')
  return key === 'component' && !!value && !['null', 'undefined', 'false'].includes(value.text)
}
