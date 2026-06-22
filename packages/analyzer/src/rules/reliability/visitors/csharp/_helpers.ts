import type { Node as SyntaxNode } from 'web-tree-sitter'
import { getCSharpRootNode, hasCSharpModifier, walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * True when the node sits inside the protected block of a `try` that has at
 * least one `catch` clause. Being inside a catch or finally block of the same
 * try does NOT count — exceptions thrown there are not handled by that try.
 */
export function isInsideCSharpTryWithCatch(node: SyntaxNode): boolean {
  let current: SyntaxNode = node
  let parent: SyntaxNode | null = node.parent
  while (parent) {
    if (parent.type === 'try_statement') {
      const body = parent.childForFieldName('body')
      const hasCatch = parent.namedChildren.some((c) => c?.type === 'catch_clause')
      if (hasCatch && body && current.id === body.id) return true
    }
    current = parent
    parent = parent.parent
  }
  return false
}

/**
 * True when the file looks like an executable entry point: named like one
 * (Program.cs / Main.cs, or under scripts/tools), uses top-level statements,
 * or declares a `static Main` method anywhere in the compilation unit.
 */
export function isCSharpEntryPointFile(node: SyntaxNode, filePath: string): boolean {
  const lowerPath = filePath.toLowerCase()
  const basename = lowerPath.split('/').pop() ?? lowerPath
  if (basename === 'program.cs' || basename === 'main.cs') return true
  if (lowerPath.includes('/scripts/') || lowerPath.includes('/tools/')) return true

  const root = getCSharpRootNode(node)
  // Top-level statements (`var builder = …; app.Run();`) are the modern
  // Program.cs shape — the compiler synthesizes Main around them.
  if (root.namedChildren.some((c) => c?.type === 'global_statement')) return true

  let hasMain = false
  walkCSharp(root, (n) => {
    if (hasMain || n.type !== 'method_declaration') return
    if (n.childForFieldName('name')?.text === 'Main' && hasCSharpModifier(n, 'static')) {
      hasMain = true
    }
  })
  return hasMain
}

/** Simple (unqualified, non-generic) name of a type reference: `System.Net.Http.HttpClient` → 'HttpClient'. */
export function simpleTypeName(text: string): string {
  const last = text.split('.').pop() ?? text
  return last.replace(/<.*$/, '')
}

/**
 * Well-known BCL/framework types whose instances own an unmanaged or otherwise
 * deterministic resource and implement IDisposable. Used by the disposable-
 * ownership rules: without a type checker we cannot resolve arbitrary field
 * types, so we match this curated set exactly (plus the `IDisposable`-typed
 * field). A curated allow-list keeps the false-positive rate at zero — a
 * `Random` or `StringBuilder` field is never flagged.
 */
export const WELL_KNOWN_DISPOSABLE_TYPES = new Set([
  'IDisposable',
  'IAsyncDisposable',
  'Stream',
  'FileStream',
  'MemoryStream',
  'BufferedStream',
  'GZipStream',
  'DeflateStream',
  'CryptoStream',
  'NetworkStream',
  'StreamReader',
  'StreamWriter',
  'BinaryReader',
  'BinaryWriter',
  'TextReader',
  'TextWriter',
  'StringReader',
  'StringWriter',
  'HttpClient',
  'HttpClientHandler',
  'HttpRequestMessage',
  'HttpResponseMessage',
  'SocketsHttpHandler',
  'Socket',
  'TcpClient',
  'TcpListener',
  'UdpClient',
  'SqlConnection',
  'SqlCommand',
  'SqlDataReader',
  'NpgsqlConnection',
  'NpgsqlCommand',
  'DbConnection',
  'DbCommand',
  'DbDataReader',
  'CancellationTokenSource',
  'SemaphoreSlim',
  'Mutex',
  'ManualResetEvent',
  'ManualResetEventSlim',
  'AutoResetEvent',
  'Timer',
  'RegistryKey',
  'SafeHandle',
  'Process',
  'WebClient',
  'Image',
  'Bitmap',
  'Graphics',
  'Font',
])

/** True when `typeName` (already simplified) names a well-known disposable type. */
export function isWellKnownDisposable(typeName: string): boolean {
  return WELL_KNOWN_DISPOSABLE_TYPES.has(typeName)
}

/** Interfaces in a class/struct base_list (`: Base, IDisposable` → ['Base', 'IDisposable']). */
export function getCSharpBaseTypeNames(typeDecl: SyntaxNode): string[] {
  const baseList = typeDecl.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return []
  return baseList.namedChildren
    .filter((c) => c && c.type !== 'comment')
    .map((c) => simpleTypeName(c!.text))
}

/** True when the type's base list names IDisposable / IAsyncDisposable. */
export function declaresIDisposable(typeDecl: SyntaxNode): boolean {
  return getCSharpBaseTypeNames(typeDecl).some(
    (b) => b === 'IDisposable' || b === 'IAsyncDisposable',
  )
}

export interface DisposableField {
  name: string
  typeName: string
  node: SyntaxNode
}

/** Names of a constructor's parameters, used to detect injected (not owned) fields. */
function constructorParameterNames(typeDecl: SyntaxNode): Set<string> {
  const names = new Set<string>()
  const body = typeDecl.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return names
  for (const member of body.namedChildren) {
    if (member?.type !== 'constructor_declaration') continue
    const params = member.childForFieldName('parameters')
    if (!params) continue
    for (const param of params.namedChildren) {
      if (param?.type !== 'parameter') continue
      const ids = param.namedChildren.filter((c) => c?.type === 'identifier')
      if (ids.length) names.add(ids[ids.length - 1]!.text)
    }
  }
  return names
}

/**
 * True when a field is *owned* by the type: it is assigned a freshly-created
 * instance (`new T(...)`) in its initializer or a constructor, and is not
 * assigned a constructor parameter (the injected typed-client / DI pattern,
 * where the container owns the lifetime). Without a type checker, ownership is
 * the line between "this class must dispose it" and "the caller does".
 */
const CREATING_EXPR_TYPES = new Set([
  'object_creation_expression',
  'implicit_object_creation_expression',
  'invocation_expression', // factory call: File.Create(...), new SqlConnection via helper
])

function fieldIsOwned(typeDecl: SyntaxNode, fieldName: string, paramNames: Set<string>): boolean {
  let created = false
  let injected = false
  walkCSharp(typeDecl, (n) => {
    // Declarator initializer: `private readonly T _f = new T();` / `= File.Create(p);`
    if (n.type === 'variable_declarator' && n.namedChildren[0]?.text === fieldName) {
      const init = n.namedChildren[1]
      if (init && CREATING_EXPR_TYPES.has(init.type)) created = true
    }
    // Constructor assignment: `_f = new T();`, `_f = File.Create(p);`, or `_f = http;`
    if (n.type === 'assignment_expression') {
      const left = n.childForFieldName('left')
      const targets =
        left?.type === 'identifier'
          ? left.text === fieldName
          : left?.type === 'member_access_expression' && left.childForFieldName('name')?.text === fieldName
      if (targets) {
        const right = n.childForFieldName('right')
        if (right && CREATING_EXPR_TYPES.has(right.type)) {
          created = true
        } else if (right?.type === 'identifier' && paramNames.has(right.text)) {
          injected = true
        }
      }
    }
  })
  return created && !injected
}

/**
 * Instance fields whose declared type is a well-known disposable type AND that
 * the class *owns* (instantiates rather than receives by injection). Static
 * fields are excluded — process-lifetime singletons (a shared HttpClient) are
 * deliberately never disposed.
 */
export function getDisposableFields(typeDecl: SyntaxNode): DisposableField[] {
  const fields: DisposableField[] = []
  const body = typeDecl.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return fields

  const paramNames = constructorParameterNames(typeDecl)

  for (const member of body.namedChildren) {
    if (member?.type !== 'field_declaration') continue
    if (member.children.some((c) => c?.type === 'modifier' && c.text === 'static')) continue

    const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
    if (!decl) continue
    const typeNode = decl.namedChildren[0]
    if (!typeNode) continue
    const typeName = simpleTypeName(typeNode.text)
    if (!isWellKnownDisposable(typeName)) continue

    for (const declarator of decl.namedChildren) {
      if (declarator?.type !== 'variable_declarator') continue
      const id = declarator.namedChildren[0]
      if (id?.type !== 'identifier') continue
      if (!fieldIsOwned(typeDecl, id.text, paramNames)) continue
      fields.push({ name: id.text, typeName, node: member })
    }
  }
  return fields
}

/** The class/struct's Dispose() method (zero-parameter), or null. */
export function findDisposeMethod(typeDecl: SyntaxNode): SyntaxNode | null {
  const body = typeDecl.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return null
  for (const member of body.namedChildren) {
    if (member?.type !== 'method_declaration') continue
    if (member.childForFieldName('name')?.text !== 'Dispose') continue
    const params = member.childForFieldName('parameters')
    if (!params || params.namedChildCount === 0) return member
  }
  return null
}
