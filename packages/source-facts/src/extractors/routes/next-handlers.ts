import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import { canonicalRoutePath, nextAppSegments, nextDynamicSegment, type RouteRegistration } from '@truecourse/shared'
import { nextRouterForFile } from '@truecourse/shared/next-routing-node'
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
  const router = nextRouterForFile(filePath, 'app')
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

// ---------------------------------------------------------------------------
// Routes declared as a FILE under `pages/api/` — the Next.js pages router.
//
// A pages-router handler is ONE default export that answers every method at
// its file's address; nothing in the export names a method. What does is the
// body: `req.method === 'POST'`, `switch (req.method) { case 'GET': … }`,
// `['GET', 'HEAD'].includes(req.method)`, or a next-connect router whose chain
// `router.get(…).post(…)`) the file default-exports. Every such literal the
// HANDLER reads — the default export and the same-file declarations it names,
// never a helper it merely calls — is a method it distinguishes, and the union
// is the operations it serves.
// A handler that distinguishes none answers every method — `GET` is emitted
// for it, since a GET does reach it, rather than a guessed set.
// ---------------------------------------------------------------------------

const PAGES_API_FILE = /\.(?:tsx|jsx|ts|js|mjs)$/

/** A file under some `pages/api/` directory — the cheap test that gates the filesystem walk. */
const UNDER_PAGES_API = /(?:^|\/)pages\/api\//

/** Callee names that mint a next-connect style router. */
const ROUTER_FACTORIES = new Set(['createRouter', 'createEdgeRouter', 'nc', 'nextConnect'])

export function extractNextPagesApiRoutes(tree: Tree, filePath: string): RouteRegistration[] {
  const normalized = path.resolve(filePath).split(path.sep).join('/')
  if (!PAGES_API_FILE.test(normalized) || !UNDER_PAGES_API.test(normalized)) return []
  const router = nextRouterForFile(filePath, 'pages')
  if (!router) return []
  const relative = normalized.slice(router.length + 1).split('/')
  if (relative[0] !== 'api') return []
  const root = tree.rootNode
  const handler = defaultExport(root)
  if (!handler) return []

  const leaf = relative[relative.length - 1]!.replace(PAGES_API_FILE, '')
  // `index` names its directory's address only as the FILE: `api/index/index.ts`
  // is `/api/index`.
  const names = [...relative.slice(1, -1), ...(leaf === 'index' ? [] : [leaf])]
  const segmentsOf = (optional: 'parent' | 'catch-all'): string[] =>
    names.flatMap((name) => nextDynamicSegment(name, optional) ?? [])
  const parent = segmentsOf('parent')
  const catchAll = segmentsOf('catch-all')
  if (catchAll.some((segment, index) => segment.startsWith('{...') && index !== catchAll.length - 1)) return []
  const paths = [...new Set([canonicalRoutePath(['api', ...parent].join('/')), canonicalRoutePath(['api', ...catchAll].join('/'))])]

  const scope = handlerScope(root, handler.node)
  const methods = [...new Set([...scope.flatMap(comparedMethods), ...routerChainMethods(root, scope)])]
  const served = methods.length > 0 ? methods : ['GET']
  return served.flatMap((method) => paths.map((routePath) => ({
    httpMethod: method as RouteRegistration['httpMethod'],
    path: routePath,
    handlerName: handler.name,
    location: {
      filePath,
      startLine: handler.node.startPosition.row + 1,
      startColumn: handler.node.startPosition.column,
      endLine: handler.node.endPosition.row + 1,
      endColumn: handler.node.endPosition.column,
    },
  })))
}

/** The file's default export and the name it was declared under, if any. */
function defaultExport(root: SyntaxNode): { node: SyntaxNode; name: string } | null {
  for (const statement of root.namedChildren) {
    if (!statement || statement.type !== 'export_statement' || hasTypeKeyword(statement)) continue
    if (!statement.children.some((node) => node?.type === 'default')) continue
    const declaration = statement.childForFieldName('declaration')
    const value = statement.childForFieldName('value')
    const named = declaration?.childForFieldName('name')?.text
    if (named) return { node: statement, name: named }
    if (value?.type === 'identifier') return { node: statement, name: value.text }
    return { node: statement, name: '' }
  }
  return null
}

/**
 * What the handler IS: the default export, and every top-level declaration of
 * this file the export's EXPRESSION names — `export default withAuth(handler)`
 * reaches `handler`, `const handler = wrap(inner)` reaches `inner`. A function
 * body is where naming stops: a helper the handler merely calls is not in it,
 * because its comparisons are about something else (`res.req.method ===
 * 'HEAD'` deciding whether to write a body), not about which methods reach
 * this address.
 */
function handlerScope(root: SyntaxNode, exported: SyntaxNode): SyntaxNode[] {
  const declarations = new Map<string, SyntaxNode>()
  for (const statement of root.namedChildren) {
    if (!statement || statement.id === exported.id) continue
    const declaration = statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement
    if (!declaration) continue
    if (declaration.type === 'function_declaration' || declaration.type === 'generator_function_declaration') {
      const name = declaration.childForFieldName('name')?.text
      if (name) declarations.set(name, declaration)
    } else if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
      for (const declarator of declaration.namedChildren) {
        const name = declarator?.childForFieldName('name')
        if (declarator && name?.type === 'identifier') declarations.set(name.text, declarator)
      }
    }
  }
  const scope = [exported]
  const named = new Set<string>()
  const collect = (node: SyntaxNode | null): void => {
    if (!node || FUNCTION_NODES.has(node.type)) return
    if (node.type === 'identifier' && declarations.has(node.text) && !named.has(node.text)) {
      named.add(node.text)
      const declaration = declarations.get(node.text)!
      scope.push(declaration)
      collect(declaration.childForFieldName('value'))
    }
    for (const child of node.namedChildren) collect(child)
  }
  collect(exported.childForFieldName('value'))
  return scope
}

/** The nodes whose body is code rather than an expression naming a handler. */
const FUNCTION_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'function',
  'arrow_function',
  'method_definition',
])

/** Every HTTP method literal `root` compares a `.method` member against. */
function comparedMethods(root: SyntaxNode): string[] {
  const out: string[] = []
  // `(req.method)`, `req.method ?? ''`, `req.method as string` all read the member.
  const unwrap = (node: SyntaxNode | null): SyntaxNode | null => {
    let current = node
    while (current) {
      if (['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression'].includes(current.type)) {
        current = current.namedChild(0)
      } else if (current.type === 'binary_expression' && ['??', '||'].includes(current.childForFieldName('operator')?.text ?? '')) {
        current = current.childForFieldName('left')
      } else {
        return current
      }
    }
    return null
  }
  const isMethodMember = (node: SyntaxNode | null): boolean => {
    const member = unwrap(node)
    return member?.type === 'member_expression' && member.childForFieldName('property')?.text === 'method'
  }
  const literalMethod = (node: SyntaxNode | null): string | null => {
    const text = node ? stringLiteral(node) : null
    return text && METHODS.has(text.toUpperCase()) ? text.toUpperCase() : null
  }
  const walk = (node: SyntaxNode): void => {
    if (node.type === 'binary_expression') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      const operator = node.childForFieldName('operator')?.text
      if (operator && ['===', '!==', '==', '!='].includes(operator)) {
        const literal = isMethodMember(left) ? literalMethod(right) : isMethodMember(right) ? literalMethod(left) : null
        if (literal) out.push(literal)
      }
    }
    if (node.type === 'switch_statement' && isMethodMember(node.childForFieldName('value'))) {
      const body = node.childForFieldName('body')
      for (const clause of body?.namedChildren ?? []) {
        if (clause?.type !== 'switch_case') continue
        const literal = literalMethod(clause.childForFieldName('value'))
        if (literal) out.push(literal)
      }
    }
    // `['GET', 'HEAD'].includes(req.method)` — membership in a literal list.
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      const args = node.childForFieldName('arguments')
      if (
        callee?.type === 'member_expression' &&
        callee.childForFieldName('property')?.text === 'includes' &&
        callee.childForFieldName('object')?.type === 'array' &&
        isMethodMember(args?.namedChild(0) ?? null)
      ) {
        for (const element of callee.childForFieldName('object')!.namedChildren) {
          const literal = literalMethod(element)
          if (literal) out.push(literal)
        }
      }
    }
    for (const child of node.namedChildren) if (child) walk(child)
  }
  walk(root)
  return out
}

/**
 * The methods a next-connect style router chain registers: `router.get(…)`
 * where `router` is bound in this file to a router factory call and is part
 * of the handler (`export default router.handler()`). The receiver gate is
 * what keeps an ORM's `.delete({...})` out of the surface.
 */
function routerChainMethods(root: SyntaxNode, scope: readonly SyntaxNode[]): string[] {
  const routers = new Set<string>()
  for (const statement of root.namedChildren) {
    if (!statement) continue
    const declaration = statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement
    if (declaration?.type !== 'lexical_declaration' && declaration?.type !== 'variable_declaration') continue
    for (const declarator of declaration.namedChildren) {
      const name = declarator?.childForFieldName('name')
      let value = declarator?.childForFieldName('value')
      while (value && ['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression'].includes(value.type)) {
        value = value.namedChild(0)
      }
      if (name?.type !== 'identifier' || value?.type !== 'call_expression') continue
      const callee = value.childForFieldName('function')
      const calleeName = callee?.type === 'identifier' ? callee.text : callee?.type === 'member_expression' ? callee.childForFieldName('property')?.text : undefined
      if (calleeName && ROUTER_FACTORIES.has(calleeName)) routers.add(name.text)
    }
  }
  const inScope = new Set<string>()
  const collect = (node: SyntaxNode): void => {
    if (node.type === 'identifier' && routers.has(node.text)) inScope.add(node.text)
    for (const child of node.namedChildren) if (child) collect(child)
  }
  for (const node of scope) collect(node)
  if (inScope.size === 0) return []
  const out: string[] = []
  const chainRoot = (node: SyntaxNode): SyntaxNode => {
    let current = node
    while (current.type === 'member_expression' || current.type === 'call_expression') {
      const inner = current.type === 'member_expression' ? current.childForFieldName('object') : current.childForFieldName('function')
      if (!inner) break
      current = inner
    }
    return current
  }
  const walk = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      if (callee?.type === 'member_expression') {
        const method = callee.childForFieldName('property')?.text.toUpperCase()
        const base = chainRoot(callee)
        if (method && METHODS.has(method) && base.type === 'identifier' && inScope.has(base.text)) out.push(method)
      }
    }
    for (const child of node.namedChildren) if (child) walk(child)
  }
  walk(root)
  return out
}
