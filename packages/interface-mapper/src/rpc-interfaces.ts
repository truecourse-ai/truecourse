/**
 * THE RPC DERIVATION — a tRPC router tree turned into the HTTP operations it
 * really serves, and nothing when the tree says nothing.
 *
 * The analyzer emits router NODES (`FileAnalysis.rpcRouters`): each one its own
 * procedures and the child routers it names. Three things have to happen before
 * a procedure is an operation a runner could call, and each is a rule about what
 * the repository STATES rather than what tRPC usually does:
 *
 *  1. **Composition.** The served name is the key path from the mounted root
 *     down (`viewer.bookings.get`), so children are resolved across files — by
 *     the declaring file's own import, and failing that by a UNIQUE router of
 *     that name anywhere. A name two files both define resolves to neither: a
 *     half-guessed prefix names a procedure the server does not have.
 *
 *  2. **The mounts.** tRPC's HTTP address exists only where an adapter is
 *     installed, so the unit of derivation is a **(mount, root) PAIR** and the
 *     product is the union over pairs — cal.com ships 29
 *     `pages/api/trpc/<router>/[trpc].ts` files, each serving a DIFFERENT
 *     sub-tree at `/api/trpc/<router>`. Each pair's prefix comes from adapter
 *     EVIDENCE and nowhere else:
 *       - the Next.js route handler's own location
 *         (`app/api/trpc/[trpc]/route.ts`, `pages/api/trpc/[trpc].ts`) or a
 *         remix adapter route (`app/routes/api.trpc.$trpc.ts`);
 *       - an `app.use('/api/trpc', …)` in a file that imports an adapter
 *         package (an `@trpc/server/adapters/…` specifier, or the community
 *         shape of a specifier ending in `/trpc-server` — `@hono/trpc-server`
 *         and friends);
 *       - an `app.use('/api/trpc/*', handler)` whose mounted identifier's
 *         IMPORT resolves to a file that imports an adapter package — the
 *         one-hop shape documenso mounts with (`router.ts` mounts
 *         `reactRouterTrpcServer`; the adapter import lives in
 *         `trpc/hono-trpc-remix.ts`). One hop only, by the same import-source
 *         matching everything else here uses; an unresolvable identifier stays
 *         no-evidence.
 *     A trailing `/*` wildcard is stripped from a `use` path — `/api/trpc/*`
 *     serves the tree at `/api/trpc`, and composing the star in would put every
 *     procedure at an address nobody answers. NO MOUNT FOUND → NOTHING IS
 *     DERIVED. There is no default: `/api/trpc` is a convention, and an
 *     operation at an address nobody serves is worse than an operation nobody
 *     mapped. The ambiguity refusal is scoped per mount PATH: two different
 *     roots claimed for the SAME path derive nothing for that path — which tree
 *     is served there is not stated — while every other pair still derives.
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
 * Note the dotted name is relative to the PAIR'S OWN ROOT: a sub-tree mounted
 * at `/api/trpc/bookings` serves `get`, not `viewer.bookings.get` — exactly
 * what the server answers at `/api/trpc/bookings/get`.
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

/**
 * A bound on the composed tree — GLOBAL across every (mount, root) pair — so a
 * generated router cannot flood the catalog. Hitting it is reported, never
 * silent (the no-silent-caps rule): whatever was clipped is a procedure the
 * catalog now honestly lacks.
 */
const MAX_PROCEDURES = 2000

/** How deep the key path may go before the walk is a cycle nobody closed. */
const MAX_DEPTH = 12

/**
 * The HTTP operations a repository's tRPC tree serves, or `[]` when the tree,
 * the mounts or the roots are not stated: the union over every resolved
 * (mount, root) pair. Ordered by path then method, so the seeds are
 * deterministic before the caller re-sorts them.
 */
export function deriveRpcOperations(fileAnalyses: readonly FileAnalysis[]): ApiInterfaceSeed[] {
  const routers: RouterEntry[] = []
  for (const file of fileAnalyses) {
    for (const router of file.rpcRouters ?? []) routers.push({ file, router })
  }
  if (routers.length === 0) return []

  const pairs = resolveMountPairs(fileAnalyses, routers)
  if (pairs.length === 0) return []

  const budget: WalkBudget = { used: 0, clipped: false }
  const out: ApiInterfaceSeed[] = []
  for (const pair of pairs) {
    const collected: ApiInterfaceSeed[] = []
    collect(pair.root, '', routers, collected, new Set(), 0, budget)

    // A router reached under two keys serves its procedures under both names,
    // but the SAME key path twice is one procedure the walk met twice.
    const byProcedure = new Map<string, ApiInterfaceSeed>()
    for (const seed of collected) {
      const procedure = seed.procedure
      if (procedure === undefined || byProcedure.has(procedure)) continue
      byProcedure.set(procedure, { ...seed, path: composePath(pair.path, seed.path) })
    }
    out.push(...byProcedure.values())
  }

  if (budget.clipped) {
    // eslint-disable-next-line no-console -- a silently clipped catalog would claim completeness it lacks.
    console.warn(
      `[interface-mapper] tRPC derivation clipped at ${MAX_PROCEDURES} procedures across ` +
        `${pairs.length} mount(s) — operations beyond the bound are not in the catalog`,
    )
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/** The walk's global procedure budget — shared by every pair, reported when it clips. */
interface WalkBudget {
  used: number
  clipped: boolean
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
  budget: WalkBudget,
): void {
  if (depth > MAX_DEPTH || visiting.has(entry)) return
  visiting.add(entry)

  for (const procedure of entry.router.procedures) {
    const method = procedure.kind === 'query' ? 'GET' : procedure.kind === 'mutation' ? 'POST' : null
    if (!method) continue
    if (budget.used >= MAX_PROCEDURES) {
      budget.clipped = true
      break
    }
    budget.used += 1
    const dotted = `${prefix}${procedure.name}`
    seeds.push({ method, path: `/${dotted}`, label: dotted, procedure: dotted })
  }

  for (const child of entry.router.children) {
    const target = resolveChild(entry, child.router, routers)
    if (!target) continue
    collect(target, `${prefix}${child.key}.`, routers, seeds, visiting, depth + 1, budget)
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

/** One mount CLAIM: the prefix stated, and the file whose imports state the served root. */
interface RpcMountClaim {
  path: string
  rootFile: FileAnalysis
}

/** One resolved (mount, root) pair — the unit the derivation walks. */
interface RpcMountPair {
  path: string
  root: RouterEntry
}

/**
 * Every (mount, root) pair the repository states. Claims come from three kinds
 * of adapter evidence (see the module doc); each claim resolves its own root by
 * {@link resolveRoot} against the file that states it — the mount file itself,
 * or, for the one-hop shape, the adapter module the mounted identifier resolves
 * to (that module is what hands the adapter its router). A claim whose root
 * does not settle states nothing; a PATH two settled claims give two different
 * roots derives nothing — which tree is served there is not stated — while
 * every other path still derives.
 */
function resolveMountPairs(
  fileAnalyses: readonly FileAnalysis[],
  routers: readonly RouterEntry[],
): RpcMountPair[] {
  const claims: RpcMountClaim[] = []
  for (const file of fileAnalyses) {
    const routed = fileRoutedMount(file.filePath)
    if (routed) claims.push({ path: routed, rootFile: file })
    const direct = mountedAdapter(file)
    if (direct) claims.push({ path: direct, rootFile: file })
    claims.push(...adapterHopMounts(file, fileAnalyses))
  }

  /** path → the distinct roots settled claims give it. */
  const byPath = new Map<string, Set<RouterEntry>>()
  for (const claim of claims) {
    const root = resolveRoot(routers, claim.rootFile)
    if (!root) continue
    const roots = byPath.get(claim.path) ?? new Set<RouterEntry>()
    roots.add(root)
    byPath.set(claim.path, roots)
  }

  const pairs: RpcMountPair[] = []
  for (const [path, roots] of byPath) {
    if (roots.size !== 1) continue // per-path ambiguity refusal
    pairs.push({ path, root: [...roots][0] })
  }
  return pairs.sort((a, b) => a.path.localeCompare(b.path))
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

/** A specifier that installs an official tRPC server adapter — express, fastify, fetch, ws. */
const OFFICIAL_ADAPTER_IMPORT = /^@trpc\/server\/adapters\//

/**
 * Does this import SPECIFIER name a tRPC server adapter package? The official
 * shape (`@trpc/server/adapters/*`) plus the community-adapter naming shape —
 * a package named `trpc-server`, scoped or not (`@hono/trpc-server`,
 * `cloudflare-workers/trpc-server`). A RELATIVE specifier never counts: a repo
 * module named `trpc-server` is the repo's own wrapper, and the one-hop rule in
 * {@link adapterHopMounts} is how its evidence reaches a mount.
 */
function isAdapterSpecifier(source: string): boolean {
  if (source.startsWith('.')) return false
  return OFFICIAL_ADAPTER_IMPORT.test(source) || source === 'trpc-server' || source.endsWith('/trpc-server')
}

function importsTrpcAdapter(file: FileAnalysis): boolean {
  return file.imports.some((imp) => isAdapterSpecifier(imp.source))
}

/**
 * A mount path as a `use()` call states it, normalized: a trailing `/*`
 * wildcard is what Hono/express spell "this prefix and below", so it is
 * stripped — the tree is served AT the prefix. A path that is nothing but a
 * wildcard states no address at all and yields `null`.
 */
function normalizeMountPath(raw: string): string | null {
  const trimmed = raw.trim()
  const stripped = trimmed.endsWith('/*') ? trimmed.slice(0, -2) : trimmed
  if (stripped === '' || stripped === '*') return null
  return stripped.startsWith('/') ? stripped : `/${stripped}`
}

/**
 * The mount an EXPLICIT adapter states: `app.use('/api/trpc', createExpressMiddleware(…))`
 * in a file that imports an adapter. The analyzer records the `.use` as a router
 * mount (its path, plus whichever identifiers the call names), so the path is
 * read from there — and only in a file whose adapter import proves the call is
 * tRPC's.
 *
 * A file that mounts several routers has to say which one is the tRPC one: the
 * mount whose path names trpc, or its single distinct path when it has exactly
 * one. Two different candidate paths and no trpc name → nothing, from this file.
 */
function mountedAdapter(file: FileAnalysis): string | null {
  if (!importsTrpcAdapter(file)) return null
  const mountPaths = (file.routerMounts ?? [])
    .map((mount) => normalizeMountPath(mount.path))
    .filter((path): path is string => path !== null)
  if (mountPaths.length === 0) return null
  const named = mountPaths.filter((path) => /(^|\/)trpc(\/|$)/i.test(path))
  const distinct = new Set(mountPaths)
  const chosen = named.length > 0 ? new Set(named) : distinct.size === 1 ? distinct : new Set<string>()
  if (chosen.size !== 1) return null
  return [...chosen][0]
}

/**
 * The one-hop adapter shape: `app.use('/api/trpc/*', reactRouterTrpcServer)`
 * where the adapter import lives not here but in the module the mounted
 * identifier is imported FROM (documenso's `router.ts` →
 * `trpc/hono-trpc-remix.ts`, which imports `@hono/trpc-server` and hands
 * `appRouter` to it). The claim's ROOT resolves against that adapter module —
 * it is the file that names the served router — and resolution is the same
 * import-source matching used everywhere, one hop only: a mounted identifier
 * whose import resolves to no analyzed file, or to one with no adapter import,
 * stays no-evidence.
 */
function adapterHopMounts(file: FileAnalysis, all: readonly FileAnalysis[]): RpcMountClaim[] {
  const mounts = file.routerMounts ?? []
  if (mounts.length === 0) return []

  const claims: RpcMountClaim[] = []
  for (const mount of mounts) {
    const path = normalizeMountPath(mount.path)
    if (path === null) continue
    const imp = file.imports.find((i) =>
      i.specifiers.some((s) => s.alias === mount.routerName || (!s.alias && s.name === mount.routerName)),
    )
    if (!imp) continue
    const target = all.find(
      (t) => t !== file && fileMatchesImportSource(file.filePath, t.filePath, imp.source),
    )
    if (!target || !importsTrpcAdapter(target)) continue
    claims.push({ path, rootFile: target })
  }
  return claims
}

/**
 * The router one mount serves — that pair's root. Read from the ADAPTER's own
 * file (it hands the adapter a router, so the router it imports or declares is
 * the one being served): exactly one router matching the names the file binds
 * settles it. TWO same-or-differently-named matches refuse — the file's own
 * statement is ambiguous, and in a many-mounts world falling back to a global
 * guess would serve the wrong tree at this pair's address. Only a file that
 * names NO router at all falls back to the single router nothing else names as
 * a child (the whole-tree heuristic the single-mount world used). Nothing
 * settled → this pair derives nothing, because mounting the wrong tree renames
 * every procedure under it.
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
  if (referenced.length > 1) return undefined

  const children = new Set<string>()
  for (const entry of routers) {
    for (const child of entry.router.children) children.add(child.router)
  }
  const roots = routers.filter((entry) => !children.has(entry.router.name))
  if (roots.length === 1) return roots[0]
  return undefined
}
