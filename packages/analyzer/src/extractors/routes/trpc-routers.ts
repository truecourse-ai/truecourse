import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RpcProcedure, RpcProcedureKind, RpcRouter, RpcRouterRef } from '@truecourse/shared'
import { stringLiteral, walk } from '../outbound-requests.js'

// ---------------------------------------------------------------------------
// Routes declared as an RPC TREE — tRPC
//
// The three sibling idioms read routes that name their own address: a call
// (`router.get('/x', h)`), a decorator (`@Post('/cancel')`), a table (Strapi).
// tRPC names no address anywhere. A router is an object literal whose values are
// builder chains —
//
//     export const bookingsRouter = router({
//       get: authedProcedure.input(schema).query(handler),
//       cancel: authedProcedure.input(schema).mutation(handler),
//     })
//
// — and routers nest, so the served name of a procedure is the KEY PATH from the
// app router down (`viewer.bookings.get` on cal.com, four segments deep). The
// address only exists once an adapter mounts the tree at a prefix, and that
// mount is in a third file the per-file extractor never sees.
//
// So this reader stops exactly where the file's own knowledge stops: it emits
// the TREE NODE — this router's procedures and the child routers it names — and
// nothing about paths or HTTP methods. Composition and the mount are the
// mapper's (`interface-mapper/rpc-interfaces.ts`), which holds every file at
// once and derives NOTHING when no adapter states a mount.
//
// THE GATE is a tRPC import, in three tiers, any one sufficient:
//
//  1. an import from `@trpc/*` — the library itself;
//  2. `initTRPC` anywhere in the file — how the root builder is created;
//  3. a router/procedure factory imported from a module whose specifier NAMES
//     trpc (`import { createTRPCRouter, publicProcedure } from "~/server/api/trpc"`,
//     `import { router } from "../../trpc"`). This tier is what carries the real
//     apps: a t3 or cal.com sub-router file imports `@trpc/server` exactly never
//     — it imports the app's own initialized builder — so tiers 1–2 alone would
//     see the root file and none of the tree hanging off it.
//
// `router` is far too common a name to trust on its own, which is why tier 3
// requires the SPECIFIER to say trpc as well, and why the value shape (a chain
// ending `.query(` / `.mutation(` / `.subscription(`) has to hold before any key
// becomes a procedure. Nothing statically unknown is guessed: a key whose value
// is neither a builder chain, a nested router, nor an identifier contributes
// nothing at all.
// ---------------------------------------------------------------------------

/** The calls that BIND a router. Matched on the callee's tail, so `t.router({…})`
 *  and a bare `router({…})` are one rule. */
const ROUTER_FACTORIES = new Set(['router', 'createTRPCRouter', 'createRouter'])

/** The chain terminals that make a value a procedure, and the method they imply. */
const PROCEDURE_TERMINALS: Record<string, RpcProcedureKind> = {
  query: 'query',
  mutation: 'mutation',
  subscription: 'subscription',
}

/** A specifier that names trpc: `@trpc/server`, `~/server/api/trpc`, `../../trpc`. */
const TRPC_SPECIFIER = /(^|[/@._-])trpc([/._-]|$)/i

/** How a tRPC module names the things a router is built from. */
const TRPC_FACTORY_IMPORT = /^(t|router|createTRPCRouter|createRouter|mergeRouters)$|(Router|Procedure|procedure)$/

/** A bound on one file, so a generated router of ten thousand keys cannot cost the run. */
const MAX_PROCEDURES_PER_ROUTER = 500

/**
 * The tRPC routers this file binds, in source order. Empty for every file that
 * shows no tRPC evidence — which reads as "this file declares no router", never
 * as "this repo has none".
 */
export function extractTrpcRouters(tree: Tree, filePath: string): RpcRouter[] {
  if (!hasTrpcEvidence(tree)) return []

  const routers: RpcRouter[] = []
  const cursor = tree.walk()

  function traverse(): void {
    const node = cursor.currentNode
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      const value = node.childForFieldName('value')
      const object = value ? routerObject(value) : null
      if (name?.type === 'identifier' && object) {
        routers.push(readRouter(name.text, object, node, filePath))
      }
    }

    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return routers
}

/** Whether this file is tRPC's at all — the three tiers of the module note. */
function hasTrpcEvidence(tree: Tree): boolean {
  let evidence = false
  walk(tree.rootNode, (node) => {
    if (evidence) return
    if (node.type === 'identifier' && node.text === 'initTRPC') {
      evidence = true
      return
    }
    if (node.type !== 'import_statement') return
    const sourceNode = node.childForFieldName('source')
    const source = sourceNode ? stringLiteral(sourceNode) : null
    if (source === null) return
    if (source.startsWith('@trpc/')) {
      evidence = true
      return
    }
    if (!TRPC_SPECIFIER.test(source)) return
    if (importedNames(node).some((name) => TRPC_FACTORY_IMPORT.test(name))) evidence = true
  })
  return evidence
}

/** The local names an import statement binds. */
function importedNames(statement: SyntaxNode): string[] {
  const names: string[] = []
  walk(statement, (node) => {
    if (node.type === 'import_specifier') {
      const alias = node.childForFieldName('alias')
      const name = node.childForFieldName('name')
      const bound = alias ?? name
      if (bound) names.push(bound.text)
    } else if (node.type === 'identifier' && node.parent?.type === 'import_clause') {
      names.push(node.text)
    }
  })
  return names
}

/**
 * The object literal a router call was given, or `null` when this value is not a
 * router call. `createTRPCRouter({…})`, `t.router({…})` and `router({…})` all
 * qualify; a router assembled from a variable (`router(routes)`) states no keys
 * and yields nothing rather than an empty router.
 */
function routerObject(value: SyntaxNode): SyntaxNode | null {
  if (value.type !== 'call_expression') return null
  const callee = value.childForFieldName('function')
  if (!callee) return null
  const tail =
    callee.type === 'member_expression'
      ? callee.childForFieldName('property')?.text
      : callee.type === 'identifier'
        ? callee.text
        : undefined
  if (tail === undefined || !ROUTER_FACTORIES.has(tail)) return null
  const first = value.childForFieldName('arguments')?.namedChild(0)
  return first?.type === 'object' ? first : null
}

/** One router binding: its own procedures (inline nesting flattened onto dotted
 *  keys) and the child routers it names. */
function readRouter(
  name: string,
  object: SyntaxNode,
  declarator: SyntaxNode,
  filePath: string,
): RpcRouter {
  const procedures: RpcProcedure[] = []
  const children: RpcRouterRef[] = []
  collect(object, '', procedures, children, filePath)
  return {
    name,
    exported: isExported(declarator),
    procedures,
    children,
    location: location(declarator, filePath),
  }
}

/**
 * The keys of one router object. A key's value decides what it is, and a value
 * the reader cannot classify is skipped:
 *
 *  - a builder chain ending `.query(` / `.mutation(` / `.subscription(` — a procedure;
 *  - a nested `router({…})` — read INLINE, its keys dotted under this one, because
 *    an inline child has no symbol for anyone to resolve later;
 *  - an identifier (`bookings: bookingsRouter`, or the `{ bookingsRouter }`
 *    shorthand) — a child reference the mapper resolves across files.
 */
function collect(
  object: SyntaxNode,
  prefix: string,
  procedures: RpcProcedure[],
  children: RpcRouterRef[],
  filePath: string,
): void {
  for (const child of object.namedChildren) {
    if (!child) continue
    if (child.type === 'shorthand_property_identifier') {
      children.push({ key: `${prefix}${child.text}`, router: child.text })
      continue
    }
    if (child.type !== 'pair') continue
    const key = propertyName(child.childForFieldName('key'))
    const value = child.childForFieldName('value')
    if (key === null || !value) continue

    const nested = routerObject(value)
    if (nested) {
      collect(nested, `${prefix}${key}.`, procedures, children, filePath)
      continue
    }
    if (value.type === 'identifier') {
      children.push({ key: `${prefix}${key}`, router: value.text })
      continue
    }
    const kind = procedureKind(value)
    if (!kind) continue
    if (procedures.length >= MAX_PROCEDURES_PER_ROUTER) return
    procedures.push({ name: `${prefix}${key}`, kind, location: location(child, filePath) })
  }
}

/**
 * The kind a builder chain declares, read off the OUTERMOST call: every tRPC
 * procedure ends in exactly one of the three terminals, whatever `.input()`,
 * `.use()` or `.output()` sits before it.
 */
function procedureKind(value: SyntaxNode): RpcProcedureKind | null {
  if (value.type !== 'call_expression') return null
  const callee = value.childForFieldName('function')
  if (callee?.type !== 'member_expression') return null
  const property = callee.childForFieldName('property')?.text
  return property === undefined ? null : (PROCEDURE_TERMINALS[property] ?? null)
}

/** Whether the declaration this declarator sits in is exported. */
function isExported(declarator: SyntaxNode): boolean {
  return declarator.parent?.parent?.type === 'export_statement'
}

function propertyName(key: SyntaxNode | null): string | null {
  if (!key) return null
  if (key.type === 'property_identifier') return key.text
  return stringLiteral(key)
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
