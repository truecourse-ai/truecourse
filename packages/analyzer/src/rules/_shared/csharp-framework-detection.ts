/**
 * Framework / library detection helpers for C# visitors.
 *
 * Rules that need framework context (ORM write detection, route-handler
 * heuristics, auth checks) detect it from the file's `using` directives —
 * the most reliable signal — cached per Tree via WeakMap.
 *
 * Mirrors `_shared/framework-detection.ts` (JS) and
 * `_shared/python-framework-detection.ts` (Python).
 */
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import { getCSharpRootNode, getCSharpAttributeNames } from './csharp-helpers.js'

export type CSharpOrm = 'efcore' | 'dapper' | 'nhibernate' | 'unknown'

export type CSharpWebFramework = 'aspnet' | 'unknown'

// ---------------------------------------------------------------------------
// Using-directive extraction (cached per Tree — Node wrappers are not
// reference-stable in web-tree-sitter, Tree is)
// ---------------------------------------------------------------------------

const usingSourceCache = new WeakMap<Tree, Set<string>>()

/** All `using` sources in the file (namespaces/types, alias targets included). */
export function getCSharpUsingSources(node: SyntaxNode): Set<string> {
  const root = getCSharpRootNode(node)
  const tree = root.tree
  const cached = usingSourceCache.get(tree)
  if (cached) return cached

  const sources = new Set<string>()
  function collect(n: SyntaxNode) {
    for (const child of n.namedChildren) {
      if (!child) continue
      if (child.type === 'using_directive') {
        for (const part of child.namedChildren) {
          if (part && (part.type === 'qualified_name' || part.type === 'identifier')) {
            sources.add(part.text)
          }
        }
      } else if (child.type === 'namespace_declaration' || child.type === 'file_scoped_namespace_declaration') {
        const declList = child.namedChildren.find((c) => c?.type === 'declaration_list')
        collect(declList ?? child)
      }
    }
  }
  collect(root)

  usingSourceCache.set(tree, sources)
  return sources
}

function anyUsingStartsWith(node: SyntaxNode, prefixes: string[]): boolean {
  const sources = getCSharpUsingSources(node)
  for (const source of sources) {
    if (prefixes.some((p) => source === p || source.startsWith(p + '.'))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// ORM / framework detection
// ---------------------------------------------------------------------------

export function detectCSharpOrm(node: SyntaxNode): CSharpOrm {
  if (anyUsingStartsWith(node, ['Microsoft.EntityFrameworkCore'])) return 'efcore'
  if (anyUsingStartsWith(node, ['Dapper'])) return 'dapper'
  if (anyUsingStartsWith(node, ['NHibernate'])) return 'nhibernate'
  return 'unknown'
}

export function detectCSharpWebFramework(node: SyntaxNode): CSharpWebFramework {
  if (anyUsingStartsWith(node, ['Microsoft.AspNetCore', 'Microsoft.Extensions.Hosting'])) return 'aspnet'
  return 'unknown'
}

export function usesEfCore(node: SyntaxNode): boolean {
  return detectCSharpOrm(node) === 'efcore'
}

export function usesDapper(node: SyntaxNode): boolean {
  return anyUsingStartsWith(node, ['Dapper'])
}

export function usesAspNet(node: SyntaxNode): boolean {
  return detectCSharpWebFramework(node) === 'aspnet'
}

// ---------------------------------------------------------------------------
// ASP.NET shapes
// ---------------------------------------------------------------------------

const CONTROLLER_BASES = new Set(['Controller', 'ControllerBase', 'ApiController'])

/** True for a class_declaration that is an ASP.NET controller. */
export function isAspNetControllerClass(classNode: SyntaxNode): boolean {
  if (classNode.type !== 'class_declaration') return false
  const attrs = getCSharpAttributeNames(classNode)
  if (attrs.includes('ApiController') || attrs.includes('Controller')) return true
  const baseList = classNode.namedChildren.find((c) => c?.type === 'base_list')
  if (baseList) {
    for (const base of baseList.namedChildren) {
      if (!base) continue
      const simple = (base.text.split('.').pop() ?? base.text).replace(/<.*$/, '')
      if (CONTROLLER_BASES.has(simple)) return true
    }
  }
  return classNode.childForFieldName('name')?.text.endsWith('Controller') ?? false
}

const MINIMAL_API_METHODS = new Set(['MapGet', 'MapPost', 'MapPut', 'MapDelete', 'MapPatch', 'MapGroup', 'MapMethods'])

/** True when the invocation registers a minimal-API route (app.MapGet(…)). */
export function isMinimalApiRouteCall(invocation: SyntaxNode): boolean {
  if (invocation.type !== 'invocation_expression') return false
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return false
  const name = fn.childForFieldName('name')
  const simple = name?.type === 'generic_name'
    ? name.namedChildren.find((c) => c?.type === 'identifier')?.text
    : name?.text
  return simple ? MINIMAL_API_METHODS.has(simple) : false
}

/** Attribute names that establish authentication/authorization in ASP.NET. */
export function isCSharpAuthAttributeName(name: string): boolean {
  const simple = name.split('.').pop() ?? name
  return simple === 'Authorize' || simple === 'RequireAuthorization' || simple.startsWith('Authorize')
}
