/**
 * C# symbol index — the semantic layer for C# analysis.
 *
 * C# needs this where other languages use import statements: a class can
 * reference another class in the same (or an ancestor) namespace across files
 * with NO `using` directive, so the dependency graph cannot be built from
 * imports. Instead we index every type declaration in the repo (pass 1) and
 * resolve type references through C#'s namespace-visibility rules (pass 2).
 *
 * Resolution is deterministic, never guessed: a reference that stays
 * ambiguous after namespace, visibility, and project ranking is counted and
 * skipped rather than resolved to the wrong file.
 */

import { readFileSync } from 'fs'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { FileAnalysis, ModuleDependency } from '@truecourse/shared'
import { parseFile } from '../parser.js'
import { discoverProjects, buildFileProjectMap, type CsprojInfo } from './csproj.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CSharpTypeKind = 'class' | 'interface' | 'struct' | 'enum' | 'record' | 'delegate'

export interface CSharpTypeDecl {
  name: string
  kind: CSharpTypeKind
  /** Containing namespace ('' = global) */
  namespace: string
  filePath: string
  /** 'public' | 'internal' (default for top-level types) */
  visibility: 'public' | 'internal'
  isStatic: boolean
  /** Raw base-list entries (superclass + interfaces), unresolved */
  baseTypes: string[]
  /** Enum members, when kind === 'enum' */
  enumMembers?: string[]
}

interface UsingDirective {
  /** Namespace or type the directive references */
  target: string
  isStatic: boolean
  isGlobal: boolean
  /** Alias name for `using Alias = Target;` */
  alias?: string
}

interface FileContext {
  filePath: string
  /** Namespaces declared in this file */
  declaredNamespaces: string[]
  usings: UsingDirective[]
  project?: CsprojInfo
}

export interface CSharpIndexStats {
  resolvedRefs: number
  ambiguousRefs: number
}

export interface CSharpSymbolIndex {
  /** All indexed type declarations */
  declarations: CSharpTypeDecl[]
  /** interface name → implementing class/record names (repo-local, from base lists) */
  interfaceImplementations: Map<string, Set<string>>
  /** DI bindings from AddScoped/AddSingleton/AddTransient<IFoo, Foo>() */
  diBindings: Map<string, string>
  /** File-level dependency edges resolved from type references */
  edges: ModuleDependency[]
  stats: CSharpIndexStats
}

// ---------------------------------------------------------------------------
// Pass 1 — declarations, namespaces, usings
// ---------------------------------------------------------------------------

const TYPE_DECL_KINDS: Record<string, CSharpTypeKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  struct_declaration: 'struct',
  enum_declaration: 'enum',
  record_declaration: 'record',
  record_struct_declaration: 'record',
  delegate_declaration: 'delegate',
}

function childOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.children) {
    if (child && child.type === type) return child
  }
  return null
}

function hasModifier(node: SyntaxNode, modifier: string): boolean {
  for (const child of node.children) {
    if (child && child.type === 'modifier' && child.text === modifier) return true
  }
  return false
}

function namespaceName(nsNode: SyntaxNode): string {
  const nameNode = nsNode.childForFieldName('name') ?? childOfType(nsNode, 'qualified_name') ?? childOfType(nsNode, 'identifier')
  return nameNode?.text ?? ''
}

function readUsing(node: SyntaxNode): UsingDirective | null {
  const isStatic = childOfType(node, 'static') !== null
  const isGlobal = childOfType(node, 'global') !== null
  const aliasNode = node.childForFieldName('name')

  let target: string | null = null
  for (const child of node.namedChildren) {
    if (!child) continue
    if (aliasNode && child.id === aliasNode.id) continue
    if (child.type === 'qualified_name' || child.type === 'identifier' || child.type === 'generic_name') {
      target = child.text
      break
    }
  }
  if (!target) return null

  return { target, isStatic, isGlobal, ...(aliasNode ? { alias: aliasNode.text } : {}) }
}

function readEnumMembers(enumNode: SyntaxNode): string[] {
  const members: string[] = []
  const list = childOfType(enumNode, 'enum_member_declaration_list')
  if (!list) return members
  for (const child of list.namedChildren) {
    if (!child || child.type !== 'enum_member_declaration') continue
    const name = child.childForFieldName('name')?.text ?? child.namedChildren[0]?.text
    if (name) members.push(name)
  }
  return members
}

function readBaseTypes(node: SyntaxNode): string[] {
  const baseList = childOfType(node, 'base_list')
  if (!baseList) return []
  const bases: string[] = []
  for (const base of baseList.namedChildren) {
    if (base) bases.push(base.text)
  }
  return bases
}

/**
 * Collect type declarations with their namespaces. Note: a file-scoped
 * namespace (`namespace X;`) is a SIBLING of the declarations it covers —
 * everything after it in the file belongs to it.
 */
function collectDeclsAndNamespaces(
  root: SyntaxNode,
  filePath: string,
  decls: CSharpTypeDecl[],
  declaredNamespaces: string[],
) {
  function walk(node: SyntaxNode, currentNs: string) {
    let activeNs = currentNs
    for (const child of node.namedChildren) {
      if (!child) continue

      if (child.type === 'file_scoped_namespace_declaration') {
        activeNs = activeNs ? `${activeNs}.${namespaceName(child)}` : namespaceName(child)
        declaredNamespaces.push(activeNs)
      } else if (child.type === 'namespace_declaration') {
        const ns = activeNs ? `${activeNs}.${namespaceName(child)}` : namespaceName(child)
        declaredNamespaces.push(ns)
        const declList = childOfType(child, 'declaration_list')
        if (declList) walk(declList, ns)
      } else if (TYPE_DECL_KINDS[child.type]) {
        const name = child.childForFieldName('name')?.text
        if (!name) continue
        const kind = TYPE_DECL_KINDS[child.type]
        decls.push({
          name,
          kind,
          namespace: activeNs,
          filePath,
          visibility: hasModifier(child, 'public') ? 'public' : 'internal',
          isStatic: hasModifier(child, 'static'),
          baseTypes: readBaseTypes(child),
          ...(kind === 'enum' ? { enumMembers: readEnumMembers(child) } : {}),
        })
      }
    }
  }

  walk(root, '')
}

function collectUsings(root: SyntaxNode, usings: UsingDirective[]) {
  function walk(node: SyntaxNode) {
    for (const child of node.namedChildren) {
      if (!child) continue
      if (child.type === 'using_directive') {
        const u = readUsing(child)
        if (u) usings.push(u)
      } else if (child.type === 'namespace_declaration') {
        const declList = childOfType(child, 'declaration_list')
        if (declList) walk(declList)
      }
    }
  }
  walk(root)
}

// ---------------------------------------------------------------------------
// Pass 2 — type-reference collection
// ---------------------------------------------------------------------------

interface TypeRef {
  /** Simple name ('Order') or qualified path ('MyApp.Domain.Order') */
  name: string
  qualified: boolean
}

/** Flatten a type-position node into candidate references (recursing generics). */
function flattenTypeNode(node: SyntaxNode, out: TypeRef[]) {
  switch (node.type) {
    case 'identifier':
      if (node.text !== 'var') out.push({ name: node.text, qualified: false })
      break
    case 'qualified_name':
      out.push({ name: node.text, qualified: true })
      break
    case 'generic_name': {
      const nameNode = childOfType(node, 'identifier')
      if (nameNode) out.push({ name: nameNode.text, qualified: false })
      const args = childOfType(node, 'type_argument_list')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg) flattenTypeNode(arg, out)
        }
      }
      break
    }
    case 'nullable_type':
    case 'array_type': {
      const inner = node.childForFieldName('type') ?? node.namedChildren[0]
      if (inner) flattenTypeNode(inner, out)
      break
    }
    case 'tuple_type':
      for (const el of node.namedChildren) {
        if (!el) continue
        const t = el.childForFieldName('type') ?? el.namedChildren[0]
        if (t) flattenTypeNode(t, out)
      }
      break
    // predefined_type, implicit_type, pointer types — never repo-local
    default:
      break
  }
}

/**
 * Collect every type reference in a file from positions where a type (not a
 * value) must appear, plus static-access roots (`PriceCalc.Compute`,
 * `Status.Active`) and generic type arguments (which also covers DI
 * registrations like AddScoped<IFoo, Foo>()).
 */
function collectTypeRefs(root: SyntaxNode): TypeRef[] {
  const refs: TypeRef[] = []

  function pushTypeField(node: SyntaxNode, field: string) {
    const t = node.childForFieldName(field)
    if (t) flattenTypeNode(t, refs)
  }

  function walk(node: SyntaxNode) {
    switch (node.type) {
      case 'object_creation_expression':
      case 'typeof_expression':
      case 'cast_expression':
        pushTypeField(node, 'type')
        break
      case 'variable_declaration':
      case 'parameter':
      case 'property_declaration':
        pushTypeField(node, 'type')
        break
      case 'method_declaration':
      case 'local_function_statement':
        pushTypeField(node, 'returns')
        break
      case 'base_list':
        for (const base of node.namedChildren) {
          if (base) flattenTypeNode(base, refs)
        }
        break
      case 'type_argument_list':
        // Generic arguments anywhere — declarations, calls, DI registrations
        for (const arg of node.namedChildren) {
          if (arg) flattenTypeNode(arg, refs)
        }
        break
      case 'attribute': {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const text = nameNode.text
          refs.push({ name: text, qualified: text.includes('.') })
          // [Audit] binds to class AuditAttribute
          if (!text.includes('.')) refs.push({ name: `${text}Attribute`, qualified: false })
        }
        break
      }
      case 'member_access_expression': {
        // Static access root: PriceCalc.Compute(...), Status.Active.
        // Only the leftmost identifier of a chain — locals/fields won't match
        // any indexed type name, so precision comes from the index lookup.
        const expr = node.childForFieldName('expression')
        if (expr?.type === 'identifier') {
          refs.push({ name: expr.text, qualified: false })
        } else if (
          expr?.type === 'member_access_expression' &&
          /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(expr.text)
        ) {
          // Namespace-qualified static access: Billing.Auditor.Record(…) —
          // the receiver is a pure dotted path, try it as a qualified type
          refs.push({ name: expr.text, qualified: true })
        }
        break
      }
      default:
        break
    }

    for (const child of node.namedChildren) {
      if (child) walk(child)
    }
  }

  walk(root)
  return refs
}

/** Scan DI registrations: services.AddScoped<IOrderService, OrderService>() */
function collectDiBindings(root: SyntaxNode, bindings: Map<string, string>) {
  const DI_METHODS = new Set(['AddScoped', 'AddSingleton', 'AddTransient'])

  function walk(node: SyntaxNode) {
    if (node.type === 'invocation_expression') {
      const fn = node.childForFieldName('function')
      // The generic method name is either the whole callee or the member name
      const genericName =
        fn?.type === 'generic_name' ? fn : fn?.childForFieldName('name')?.type === 'generic_name' ? fn.childForFieldName('name') : null
      if (genericName) {
        const methodName = childOfType(genericName, 'identifier')?.text
        if (methodName && DI_METHODS.has(methodName)) {
          const args = childOfType(genericName, 'type_argument_list')
          const typeArgs = args?.namedChildren.filter(Boolean) ?? []
          if (typeArgs.length === 2) {
            const iface = typeArgs[0]!.text
            const impl = typeArgs[1]!.text
            bindings.set(iface, impl)
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      if (child) walk(child)
    }
  }

  walk(root)
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** A namespace and all its ancestors: 'A.B.C' → ['A.B.C', 'A.B', 'A', '']. */
function namespaceChain(ns: string): string[] {
  if (!ns) return ['']
  const parts = ns.split('.')
  const chain: string[] = []
  for (let i = parts.length; i > 0; i--) {
    chain.push(parts.slice(0, i).join('.'))
  }
  chain.push('')
  return chain
}

function isDeclVisibleFrom(decl: CSharpTypeDecl, fromProject: CsprojInfo | undefined, declProject: CsprojInfo | undefined): boolean {
  if (decl.visibility === 'public') return true
  // internal: same assembly (project) only. Without project info, allow —
  // single-project repos have no csproj boundaries to violate.
  if (!fromProject || !declProject) return true
  return fromProject.projectDir === declProject.projectDir
}

/** Rank a candidate: 0 = same project, 1 = referenced project, 2 = other. */
function projectRank(fromProject: CsprojInfo | undefined, declProject: CsprojInfo | undefined): number {
  if (!fromProject || !declProject) return 2
  if (fromProject.projectDir === declProject.projectDir) return 0
  if (fromProject.projectReferences.includes(declProject.projectDir)) return 1
  return 2
}

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

/**
 * Build the C# symbol index for a set of analyzed files. Re-parses the
 * `.cs` files (tree-sitter parse is cheap; trees are not retained on
 * FileAnalysis). Requires initParsers() to have run — true anywhere
 * downstream of analyzeRepository/analyzeFile.
 */
export function buildCSharpSymbolIndex(files: FileAnalysis[], rootPath: string): CSharpSymbolIndex {
  const csFiles = files.filter((f) => f.language === 'csharp')

  const projects = discoverProjects(rootPath)
  const fileProjects = buildFileProjectMap(csFiles.map((f) => f.filePath), projects)

  const declarations: CSharpTypeDecl[] = []
  const fileContexts: FileContext[] = []
  const diBindings = new Map<string, string>()
  /** project dir ('' = no project) → global using targets */
  const globalUsings = new Map<string, Set<string>>()

  // ---- Pass 1: declarations, namespaces, usings, DI registrations ----
  const trees = new Map<string, SyntaxNode>()
  for (const file of csFiles) {
    let root: SyntaxNode
    try {
      const content = readFileSync(file.filePath, 'utf-8')
      root = parseFile(file.filePath, content, 'csharp').rootNode
    } catch {
      continue
    }
    trees.set(file.filePath, root)

    const declaredNamespaces: string[] = []
    collectDeclsAndNamespaces(root, file.filePath, declarations, declaredNamespaces)

    const usings: UsingDirective[] = []
    collectUsings(root, usings)

    const project = fileProjects.get(file.filePath)
    const projectKey = project?.projectDir ?? ''
    for (const u of usings) {
      if (u.isGlobal) {
        if (!globalUsings.has(projectKey)) globalUsings.set(projectKey, new Set())
        globalUsings.get(projectKey)!.add(u.target)
      }
    }

    fileContexts.push({ filePath: file.filePath, declaredNamespaces, usings, project })
    collectDiBindings(root, diBindings)
  }

  // Lookup structures
  const byName = new Map<string, CSharpTypeDecl[]>()
  const byFullName = new Map<string, CSharpTypeDecl[]>()
  for (const decl of declarations) {
    if (!byName.has(decl.name)) byName.set(decl.name, [])
    byName.get(decl.name)!.push(decl)
    const full = decl.namespace ? `${decl.namespace}.${decl.name}` : decl.name
    if (!byFullName.has(full)) byFullName.set(full, [])
    byFullName.get(full)!.push(decl)
  }

  const stats: CSharpIndexStats = { resolvedRefs: 0, ambiguousRefs: 0 }

  function resolveQualified(path: string): CSharpTypeDecl[] {
    const exact = byFullName.get(path)
    if (exact) return exact
    // Nested-type access (Outer.Inner) or partially qualified — try the
    // longest prefix that names an indexed type.
    const parts = path.split('.')
    for (let i = parts.length - 1; i > 0; i--) {
      const prefix = parts.slice(0, i).join('.')
      const found = byFullName.get(prefix)
      if (found) return found
    }
    return []
  }

  function resolveRef(ref: TypeRef, ctx: FileContext, visibleNamespaces: Set<string>, aliases: Map<string, string>): CSharpTypeDecl[] {
    if (ref.qualified) {
      // Expand a namespace/type alias in the first segment
      const firstDot = ref.name.indexOf('.')
      const head = ref.name.slice(0, firstDot)
      const aliasTarget = aliases.get(head)
      const path = aliasTarget ? `${aliasTarget}${ref.name.slice(firstDot)}` : ref.name
      return resolveQualified(path).filter((d) =>
        isDeclVisibleFrom(d, ctx.project, fileProjects.get(d.filePath)),
      )
    }

    const aliasTarget = aliases.get(ref.name)
    if (aliasTarget) {
      return resolveQualified(aliasTarget).filter((d) =>
        isDeclVisibleFrom(d, ctx.project, fileProjects.get(d.filePath)),
      )
    }

    const candidates = (byName.get(ref.name) ?? []).filter(
      (d) =>
        visibleNamespaces.has(d.namespace) &&
        isDeclVisibleFrom(d, ctx.project, fileProjects.get(d.filePath)),
    )
    if (candidates.length === 0) return []

    const namespaces = new Set(candidates.map((d) => d.namespace))
    if (namespaces.size === 1) return candidates // incl. partial classes across files

    // Same name visible from multiple namespaces — prefer the closest project
    const ranked = candidates.map((d) => ({ d, rank: projectRank(ctx.project, fileProjects.get(d.filePath)) }))
    const bestRank = Math.min(...ranked.map((r) => r.rank))
    const best = ranked.filter((r) => r.rank === bestRank).map((r) => r.d)
    if (new Set(best.map((d) => d.namespace)).size === 1) return best

    stats.ambiguousRefs++
    return []
  }

  // ---- Pass 2: resolve references → edges ----
  const edges: ModuleDependency[] = []

  for (const ctx of fileContexts) {
    const root = trees.get(ctx.filePath)
    if (!root) continue

    // Visible namespaces: own namespaces + all their ancestors (C# name
    // lookup walks outward), plus using directives, plus the project's
    // global usings. ImplicitUsings only injects System.* namespaces —
    // never repo-local — so it cannot affect edge resolution.
    const visibleNamespaces = new Set<string>()
    for (const ns of ctx.declaredNamespaces.length ? ctx.declaredNamespaces : ['']) {
      for (const ancestor of namespaceChain(ns)) visibleNamespaces.add(ancestor)
    }
    const aliases = new Map<string, string>()
    const directRefs: TypeRef[] = []
    for (const u of ctx.usings) {
      if (u.alias) {
        aliases.set(u.alias, u.target)
      } else if (u.isStatic) {
        // `using static X.Y.T` imports T's members — the directive itself
        // references the type
        directRefs.push({ name: u.target, qualified: u.target.includes('.') })
      } else {
        visibleNamespaces.add(u.target)
      }
    }
    const projectGlobals = globalUsings.get(ctx.project?.projectDir ?? '')
    if (projectGlobals) {
      for (const target of projectGlobals) visibleNamespaces.add(target)
    }

    const refs = [...collectTypeRefs(root), ...directRefs]

    // file → (target file → imported type names)
    const targets = new Map<string, Set<string>>()
    for (const ref of refs) {
      const decls = resolveRef(ref, ctx, visibleNamespaces, aliases)
      if (decls.length === 0) continue
      stats.resolvedRefs++
      for (const decl of decls) {
        if (decl.filePath === ctx.filePath) continue
        if (!targets.has(decl.filePath)) targets.set(decl.filePath, new Set())
        targets.get(decl.filePath)!.add(decl.name)
      }
    }

    for (const [target, names] of targets) {
      edges.push({
        source: ctx.filePath,
        target,
        importedNames: [...names].sort(),
      })
    }
  }

  // ---- Interface implementations (repo-local, from base lists) ----
  const interfaceImplementations = new Map<string, Set<string>>()
  const interfaceNames = new Set(declarations.filter((d) => d.kind === 'interface').map((d) => d.name))
  for (const decl of declarations) {
    if (decl.kind !== 'class' && decl.kind !== 'record') continue
    for (const base of decl.baseTypes) {
      // Strip namespace qualification and generic arguments
      const simple = (base.split('.').pop() ?? base).replace(/<.*$/, '')
      if (interfaceNames.has(simple)) {
        if (!interfaceImplementations.has(simple)) interfaceImplementations.set(simple, new Set())
        interfaceImplementations.get(simple)!.add(decl.name)
      }
    }
  }

  return { declarations, interfaceImplementations, diBindings, edges, stats }
}

/**
 * Dependency-graph edge contributor for C# (see resolvers/registry.ts).
 * Builds the symbol index and returns its file-level edges.
 */
export function contributeCSharpEdges(files: FileAnalysis[], rootPath: string): ModuleDependency[] {
  const index = buildCSharpSymbolIndex(files, rootPath)
  if (index.stats.ambiguousRefs > 0) {
    console.warn(
      `[TrueCourse] C# symbol index: ${index.stats.ambiguousRefs} ambiguous type reference(s) skipped (same type name visible from multiple namespaces)`,
    )
  }
  return index.edges
}
