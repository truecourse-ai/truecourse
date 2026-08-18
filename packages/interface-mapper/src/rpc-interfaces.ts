/**
 * THE RPC DERIVATION — a tRPC router tree turned into the HTTP operations it
 * really serves, and nothing when the tree says nothing.
 *
 * The analyzer emits router NODES (`FileAnalysis.rpcRouters`): each one its own
 * procedures and the child routers it names. Three things have to happen before
 * a procedure is an operation a runner could call, and each is a rule about what
 * the repository STATES rather than what tRPC usually does:
 *
 *  1. **Composition.** The served name is the key path from the app router down
 *     (`viewer.bookings.get`), so children are resolved across files — by the
 *     declaring file's own import, and failing that by a UNIQUE router of that
 *     name anywhere. A name two files both define resolves to neither: a
 *     half-guessed prefix names a procedure the server does not have.
 *
 *  2. **The mount.** tRPC's HTTP address exists only where an adapter is
 *     installed, so the prefix comes from adapter EVIDENCE and nowhere else: the
 *     Next.js route handler's own location (`app/api/trpc/[trpc]/route.ts`,
 *     `pages/api/trpc/[trpc].ts`), a remix adapter route
 *     (`app/routes/api.trpc.$trpc.ts`), or an `app.use('/api/trpc', …)` in a file
 *     that imports a `@trpc/server/adapters/*`. NO MOUNT FOUND → NOTHING IS
 *     DERIVED. There is no default: `/api/trpc` is a convention, and an
 *     operation at an address nobody serves is worse than an operation nobody
 *     mapped. Two disagreeing mounts derive nothing for the same reason — which
 *     tree is served where is not stated.
 *
 *  3. **The method.** tRPC's own HTTP contract: `.query` is a GET,
 *     `.mutation` is a POST, both at `<mount>/<dotted procedure>`. A
 *     `.subscription` is neither — it is a websocket/SSE stream with no method
 *     in `GuardHttpRequestSchema`'s closed enum — so it yields no operation
 *     rather than a request the runner cannot make.
 *
 * The product is {@link ApiInterfaceSeed}s, joined by `deriveApiInterfacesFromTree`
 * as a third source beside route registrations and OpenAPI: identity is the
 * operation there, and it stays the operation here. Each seed carries the dotted
 * `procedure` — the marker that says where it came from, and the key the
 * frontend join matches a `trpc.viewer.bookings.get.useQuery` call against.
 *
 * Pure over the analyzer's artifacts, like the rest of this package: no
 * filesystem, no module graph, no LLM.
 */

import type { FileAnalysis, RpcRouter } from '@truecourse/shared'
import type { ApiInterfaceSeed } from './api-interfaces.js'
import { composePath, fileMatchesImportSource } from './api-tree.js'

/** One router binding and the file that declares it. */
interface RouterEntry {
  file: FileAnalysis
  router: RpcRouter
}

/** A bound on the composed tree, so a generated router cannot flood the catalog. */
const MAX_PROCEDURES = 2000

/** How deep the key path may go before the walk is a cycle nobody closed. */
const MAX_DEPTH = 12

/**
 * The HTTP operations a repository's tRPC tree serves, or `[]` when the tree,
 * the mount or the root router is not stated. Ordered by procedure name, so the
 * seeds are deterministic before the caller sorts them by path.
 */
export function deriveRpcOperations(fileAnalyses: readonly FileAnalysis[]): ApiInterfaceSeed[] {
  const routers: RouterEntry[] = []
  for (const file of fileAnalyses) {
    for (const router of file.rpcRouters ?? []) routers.push({ file, router })
  }
  if (routers.length === 0) return []

  const mount = resolveMount(fileAnalyses)
  if (!mount) return []

  const root = resolveRoot(routers, mount.file)
  if (!root) return []

  const collected: ApiInterfaceSeed[] = []
  collect(root, '', routers, collected, new Set(), 0)

  // A router reached under two keys serves its procedures under both names, but
  // the SAME key path twice is one procedure the walk met twice.
  const byProcedure = new Map<string, ApiInterfaceSeed>()
  for (const seed of collected) {
    const procedure = seed.procedure
    if (procedure === undefined || byProcedure.has(procedure)) continue
    byProcedure.set(procedure, { ...seed, path: composePath(mount.path, seed.path) })
  }
  return [...byProcedure.values()].sort((a, b) => (a.procedure ?? '').localeCompare(b.procedure ?? ''))
}

/**
 * The procedures reachable from one router, depth-first in key order. Paths are
 * the DOTTED NAME at this stage — the mount is composed on once, by the caller,
 * so a mis-stated mount cannot land half-way down the tree.
 */
function collect(
  entry: RouterEntry,
  prefix: string,
  routers: readonly RouterEntry[],
  seeds: ApiInterfaceSeed[],
  visiting: Set<RouterEntry>,
  depth: number,
): void {
  if (depth > MAX_DEPTH || visiting.has(entry) || seeds.length >= MAX_PROCEDURES) return
  visiting.add(entry)

  for (const procedure of entry.router.procedures) {
    const method = procedure.kind === 'query' ? 'GET' : procedure.kind === 'mutation' ? 'POST' : null
    if (!method) continue
    if (seeds.length >= MAX_PROCEDURES) break
    const dotted = `${prefix}${procedure.name}`
    seeds.push({ method, path: `/${dotted}`, label: dotted, procedure: dotted })
  }

  for (const child of entry.router.children) {
    const target = resolveChild(entry, child.router, routers)
    if (!target) continue
    collect(target, `${prefix}${child.key}.`, routers, seeds, visiting, depth + 1)
  }

  visiting.delete(entry)
}

/**
 * The router a child reference names: the one the declaring file IMPORTS under
 * that name, or — for a router declared beside it, or reached through a barrel
 * the mapper cannot follow — the single router of that name in the whole tree.
 * Two candidates resolve to none.
 */
function resolveChild(
  from: RouterEntry,
  name: string,
  routers: readonly RouterEntry[],
): RouterEntry | undefined {
  const byName = routers.filter((entry) => entry.router.name === name)
  if (byName.length === 0) return undefined
  if (byName.length === 1) return byName[0]

  for (const imp of from.file.imports) {
    const bound = imp.specifiers.some((s) => s.alias === name || (!s.alias && s.name === name))
    if (!bound) continue
    const match = byName.find((entry) =>
      fileMatchesImportSource(from.file.filePath, entry.file.filePath, imp.source),
    )
    if (match) return match
  }
  const local = byName.find((entry) => entry.file === from.file)
  return local
}

/** One adapter mount: the prefix it serves the tree at, and the file that states it. */
interface RpcMount {
  path: string
  file: FileAnalysis
}

/**
 * The single mount the repository states, or `null` when it states none or more
 * than one. Candidates are deduped BY PATH first: a monorepo that installs the
 * same `/api/trpc` handler in two apps still states one address, and only two
 * DIFFERENT addresses are the ambiguity that derives nothing.
 */
function resolveMount(fileAnalyses: readonly FileAnalysis[]): RpcMount | null {
  const byPath = new Map<string, RpcMount>()
  for (const file of fileAnalyses) {
    const path = adapterMount(file)
    if (path && !byPath.has(path)) byPath.set(path, { path, file })
  }
  if (byPath.size !== 1) return null
  return [...byPath.values()][0]
}

/** The mount one file states as a tRPC adapter, by location or by call. */
function adapterMount(file: FileAnalysis): string | null {
  return fileRoutedMount(file.filePath) ?? mountedAdapter(file)
}

/** Extensions a framework route handler is written in. */
const MODULE_EXTENSION = /\.(?:m|c)?[jt]sx?$/

/** The catch-all segment every tRPC file route uses: `[trpc]`, `[...trpc]`, `$trpc`. */
const CATCH_ALL = /^(?:\[(?:\.{3})?[^\]]*trpc[^\]]*\]|\$trpc)$/i

/**
 * The mount a FILE-ROUTED adapter states by sitting where it sits. Next.js app
 * router (`app/api/trpc/[trpc]/route.ts`), Next.js pages
 * (`pages/api/trpc/[trpc].ts`) and remix flat routes
 * (`app/routes/api.trpc.$trpc.ts`) all encode the served prefix in the path, and
 * that encoding is the evidence — no import is needed, because the framework
 * serves the file wherever it is.
 */
function fileRoutedMount(filePath: string): string | null {
  const segments = filePath.split('/').filter(Boolean)
  const fileName = segments[segments.length - 1]
  if (fileName === undefined) return null
  const base = fileName.replace(MODULE_EXTENSION, '')

  // remix flat route: the whole address is the dotted basename.
  const routesAt = segments.lastIndexOf('routes')
  if (routesAt >= 0 && routesAt === segments.length - 2 && base.includes('.')) {
    const parts = base.split('.').filter((part) => !CATCH_ALL.test(part) && !part.startsWith('$'))
    if (parts.some((part) => part.toLowerCase() === 'trpc')) return `/${parts.join('/')}`
    return null
  }

  const rootAt = Math.max(segments.lastIndexOf('app'), segments.lastIndexOf('pages'))
  if (rootAt < 0) return null
  // The address is what sits between the routing root and the catch-all: the
  // Next app router puts the handler in `route.ts` under the catch-all DIRECTORY,
  // the pages router names the FILE after it.
  const between =
    base === 'route'
      ? segments.slice(rootAt + 1, segments.length - 2)
      : segments.slice(rootAt + 1, segments.length - 1)
  const catchAll = base === 'route' ? segments[segments.length - 2] : base
  if (catchAll === undefined || !CATCH_ALL.test(catchAll)) return null
  if (between.length === 0 || between.some((part) => part.startsWith('[') || part.startsWith('('))) return null
  if (!between.some((part) => part.toLowerCase() === 'trpc')) return null
  return `/${between.join('/')}`
}

/** A specifier that installs a tRPC server adapter — express, fastify, fetch, ws. */
const ADAPTER_IMPORT = /^@trpc\/server\/adapters\//

/**
 * The mount an EXPLICIT adapter states: `app.use('/api/trpc', createExpressMiddleware(…))`
 * in a file that imports one. The analyzer records the `.use` as a router mount
 * (its path, plus whichever identifiers the call names), so the path is read from
 * there — and only in a file whose adapter import proves the call is tRPC's.
 *
 * A file that mounts several routers has to say which one is the tRPC one: the
 * mount whose path names trpc, or its single mount when it has exactly one.
 */
function mountedAdapter(file: FileAnalysis): string | null {
  if (!file.imports.some((imp) => ADAPTER_IMPORT.test(imp.source))) return null
  const mounts = file.routerMounts ?? []
  if (mounts.length === 0) return null
  const named = mounts.filter((mount) => /(^|\/)trpc(\/|$)/i.test(mount.path))
  const chosen = named.length > 0 ? named : mounts.length === 1 ? mounts : []
  const paths = new Set(chosen.map((mount) => mount.path))
  if (paths.size !== 1) return null
  const only = [...paths][0]
  return only.startsWith('/') ? only : `/${only}`
}

/**
 * The router the mount serves — the tree's root. Read from the ADAPTER's own
 * file first (it hands the adapter a router, so the router it imports or
 * declares is the one being served); failing that, the single router nothing
 * else names as a child. Neither settled → nothing is derived, because mounting
 * the wrong tree renames every procedure under it.
 */
function resolveRoot(
  routers: readonly RouterEntry[],
  adapterFile: FileAnalysis,
): RouterEntry | undefined {
  const named = new Set<string>()
  for (const imp of adapterFile.imports) {
    for (const spec of imp.specifiers) named.add(spec.alias ?? spec.name)
  }
  for (const entry of routers) {
    if (entry.file === adapterFile) named.add(entry.router.name)
  }
  const referenced = routers.filter((entry) => named.has(entry.router.name))
  if (referenced.length === 1) return referenced[0]

  const children = new Set<string>()
  for (const entry of routers) {
    for (const child of entry.router.children) children.add(child.router)
  }
  const roots = routers.filter((entry) => !children.has(entry.router.name))
  if (roots.length === 1) return roots[0]
  return undefined
}
