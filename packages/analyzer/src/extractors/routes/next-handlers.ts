import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import { canonicalRoutePath, nextAppSegments, type RouteRegistration } from '@truecourse/shared'
import { nextAppRouterForFile } from '@truecourse/shared/next-routing-node'
import path from 'node:path'
import { stringLiteral } from '../outbound-requests.js'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const FUNCTIONS = new Set(['function_declaration', 'function_expression', 'function', 'arrow_function'])

export interface NextHandlerExport {
  method: RouteRegistration['httpMethod']
  /** Unique export/declarator site, shared with the contract join. */
  node: SyntaxNode
  handler: SyntaxNode | null
  handlerName: string
}

/** Explicit value exports only. Local aliases resolve without executing wrappers or imports. */
export function nextHandlerExports(root: SyntaxNode): NextHandlerExport[] {
  const bindings = new Map<string, SyntaxNode>()
  const imports = new Set<string>()
  const destructured = new Set<string>()
  for (const statement of root.namedChildren) {
    if (!statement) continue
    if (statement.type === 'import_statement' && !hasTypeKeyword(statement)) {
      const clause = statement.namedChildren.find((node) => node?.type === 'import_clause')
      for (const child of clause?.namedChildren ?? []) {
        if (!child) continue
        if (child.type === 'identifier') imports.add(child.text)
        for (const specifier of child.namedChildren) {
          if (!specifier || specifier.type !== 'import_specifier' || hasTypeKeyword(specifier)) continue
          const name = specifier.childForFieldName('alias') ?? specifier.childForFieldName('name')
          if (name) imports.add(name.text)
        }
      }
    }
    const declaration = statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement
    if (!declaration) continue
    if (FUNCTIONS.has(declaration.type)) {
      const name = declaration.childForFieldName('name')
      if (name) bindings.set(name.text, declaration)
    }
    if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
      for (const declarator of declaration.namedChildren) {
        const name = declarator?.childForFieldName('name')
        const value = declarator?.childForFieldName('value')
        if (name?.type === 'identifier' && value) bindings.set(name.text, value)
        if (name?.type === 'object_pattern' && value) {
          for (const binding of objectBindings(name)) destructured.add(binding.text)
        }
      }
    }
  }

  function resolve(node: SyntaxNode | undefined, seen = new Set<string>()): { valid: boolean; handler: SyntaxNode | null } {
    if (!node) return { valid: false, handler: null }
    if (FUNCTIONS.has(node.type)) return { valid: true, handler: node }
    if (['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression'].includes(node.type)) {
      return resolve(node.namedChild(0) ?? undefined, seen)
    }
    if (node.type === 'call_expression' || node.type === 'member_expression') return { valid: true, handler: null }
    if (node.type !== 'identifier' || seen.has(node.text)) return { valid: false, handler: null }
    seen.add(node.text)
    if (imports.has(node.text) || destructured.has(node.text)) return { valid: true, handler: null }
    return resolve(bindings.get(node.text), seen)
  }

  const exports: NextHandlerExport[] = []
  function emit(method: string, node: SyntaxNode, value: SyntaxNode | undefined, name: string, reexport = false): void {
    if (!METHODS.has(method)) return
    const resolved = reexport ? { valid: true, handler: null } : resolve(value)
    if (resolved.valid) exports.push({ method: method as NextHandlerExport['method'], node, handler: resolved.handler, handlerName: name })
  }
  for (const statement of root.namedChildren) {
    if (!statement || statement.type !== 'export_statement' || hasTypeKeyword(statement)) continue
    if (statement.children.some((node) => node?.type === 'default')) continue
    const declaration = statement.childForFieldName('declaration')
    if (declaration?.type === 'function_declaration') {
      const name = declaration.childForFieldName('name')?.text ?? ''
      emit(name, declaration, declaration, name)
    }
    if (declaration?.type === 'lexical_declaration' || declaration?.type === 'variable_declaration') {
      for (const declarator of declaration.namedChildren) {
        if (declarator?.type !== 'variable_declarator') continue
        const nameNode = declarator.childForFieldName('name')
        if (nameNode?.type === 'object_pattern') {
          for (const binding of objectBindings(nameNode)) emit(binding.text, binding, undefined, binding.text, true)
        } else {
          const name = nameNode?.text ?? ''
          emit(name, declarator, declarator.childForFieldName('value') ?? undefined, name)
        }
      }
    }
    const clause = statement.namedChildren.find((node) => node?.type === 'export_clause')
    for (const specifier of clause?.namedChildren ?? []) {
      if (!specifier || specifier.type !== 'export_specifier' || hasTypeKeyword(specifier)) continue
      const name = specifier.childForFieldName('name')
      const alias = specifier.childForFieldName('alias') ?? name
      if (name && alias) emit(stringLiteral(alias) ?? alias.text, specifier, name, name.text, !!statement.childForFieldName('source'))
    }
  }
  return exports
}


/** Object destructuring exports the local binding, not the source property name. */
function objectBindings(pattern: SyntaxNode): SyntaxNode[] {
  return pattern.namedChildren.flatMap((child) => {
    if (!child) return []
    if (child.type === 'shorthand_property_identifier_pattern') return [child]
    const value = child.type === 'pair_pattern' ? child.childForFieldName('value') : null
    return value?.type === 'identifier' ? [value] : []
  })
}

function hasTypeKeyword(node: SyntaxNode): boolean {
  return node.children.some((child) => child?.type === 'type')
}

export function extractNextAppRoutes(tree: Tree, filePath: string): RouteRegistration[] {
  if (!/(?:^|[/\\])route\.(?:ts|js)$/.test(filePath)) return []
  const router = nextAppRouterForFile(filePath)
  if (!router) return []
  const relative = path.resolve(filePath).split(path.sep).join('/').slice(router.length + 1).split('/').slice(0, -1)
  const parent = nextAppSegments(relative)
  const catchAll = nextAppSegments(relative, 'catch-all')
  if (!parent || !catchAll) return []
  // Catch-alls must be terminal after URL-invisible route groups are removed.
  if (catchAll.some((segment, index) => segment.startsWith('{...') && index !== catchAll.length - 1)) return []
  const paths = [...new Set([canonicalRoutePath(parent.join('/')), canonicalRoutePath(catchAll.join('/'))])]
  return nextHandlerExports(tree.rootNode).flatMap(({ method, node, handlerName }) => paths.map((routePath) => ({
    httpMethod: method,
    path: routePath,
    handlerName,
    location: {
      filePath,
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
    },
  })))
}
