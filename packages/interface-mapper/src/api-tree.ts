/**
 * The api derivation: HTTP operations from every declaration of the surface —
 * route registrations the analyzer read out of the framework's own calls
 * (`FileAnalysis.routeRegistrations` + `routerMounts`), the procedures of a tRPC
 * router tree once an adapter states where it is mounted (`rpc-interfaces.ts`),
 * the operations of any committed OpenAPI doc, and the `openapi: {method, path}`
 * METAS that declare a procedure's REST address beside the procedure instead of
 * in any route table. The union is the surface; identity is the operation, so
 * the sources dedupe onto one interface (`api-interfaces.ts`).
 *
 * THE META BASE RULE: a meta's path is relative — `/envelope/distribute` is
 * served at `/api/v2/envelope/distribute` — and nothing in the literal says
 * where. The base is taken from the app's own declaration: the prefix at which
 * it SERVES ITS OPENAPI DOCUMENT (`GET /api/v2/openapi.json`), and only when the
 * file registering that document ALSO answers everything under the same prefix
 * with a catch-all (`app.use('/api/v2/*', handler)`). Both halves are required,
 * and the second is what keeps a neighbouring API honest: documenso publishes a
 * v1 document from `packages/api/hono.ts` — a different app, whose base is NOT
 * where the v2 metas live — and that file declares no catch-all, so its prefix
 * never claims them. NO QUALIFYING BASE → NO META OPERATIONS: a guessed prefix
 * names an address the server does not answer, which is the same refusal the RPC
 * derivation makes when no adapter states a mount. An app that documents the
 * same surface at several bases (documenso's `/api/v2` and `/api/v2-beta`)
 * derives it at each, because each is a live address.
 *
 * The OpenAPI double-agent rule: an operation declared in an OpenAPI doc with NO
 * matching route registration is kept and marked `specOnly` — the
 * documented-but-unimplemented drift cross-check. The mark is only meaningful
 * when the tree yielded route registrations at all: on a repo whose framework no
 * route extractor reads (zero code-side routes), nothing is marked, because
 * "the mapper can't see your code" must never read as "your code lacks this".
 */

import { canonicalRoutePath, type FileAnalysis, type Interface, type RouterMount } from '@truecourse/shared'
import { buildApiInterfaces, type ApiInterfaceSeed } from './api-interfaces.js'
import { deriveRpcOperations } from './rpc-interfaces.js'

/** One OpenAPI operation, as `deriveOpenApiSections` reports it. */
export interface ApiSpecOperation {
  /** HTTP method, any case. */
  method: string
  /** Path template as the doc declares it, e.g. `/todos/{id}`. */
  routePath: string
  /** Cosmetic — becomes the interface label when the code side has no handler name. */
  operationId?: string
}

/**
 * Derive the api interfaces: route registrations (mount prefixes composed) ∪
 * tRPC procedures (mounted) ∪ OpenAPI operations, one interface per operation,
 * deterministically ordered by path then method.
 */
export function deriveApiInterfacesFromTree(
  fileAnalyses: readonly FileAnalysis[],
  specOperations: readonly ApiSpecOperation[] = [],
): Interface[] {
  const merged = new Map<string, ApiInterfaceSeed>()

  const codeOps = collectRouteOperations(fileAnalyses)
  for (const op of codeOps) {
    const key = `${op.method} ${op.path}`
    if (!merged.has(key)) merged.set(key, op)
  }

  // The RPC half joins on the same key as everything else — the operation — so a
  // procedure whose address a route table ALSO declares (a hand-written catch-all
  // beside the adapter) stays one interface, and keeps the procedure name that
  // says what it is.
  const rpcOps = deriveRpcOperations(fileAnalyses)
  for (const op of rpcOps) {
    const key = `${op.method} ${op.path}`
    const existing = merged.get(key)
    if (existing) {
      if (!existing.procedure) existing.procedure = op.procedure
      continue
    }
    merged.set(key, op)
  }

  // The meta half joins on the operation like everything else, so a path a route
  // table ALSO registers (documenso's download routes, which the adapter shadows)
  // stays one interface.
  for (const op of collectMetaOperations(fileAnalyses, codeOps)) {
    const key = `${op.method} ${op.path}`
    const existing = merged.get(key)
    if (existing) {
      if (!existing.label && op.label) existing.label = op.label
      continue
    }
    merged.set(key, op)
  }

  for (const spec of specOperations) {
    const method = spec.method.trim().toUpperCase()
    const path = canonicalRoutePath(spec.routePath)
    if (!method) continue
    const key = `${method} ${path}`
    const existing = merged.get(key)
    if (existing) {
      if (!existing.label && spec.operationId) existing.label = spec.operationId
      continue
    }
    merged.set(key, {
      method,
      path,
      ...(spec.operationId ? { label: spec.operationId } : {}),
      // Only a repo whose framework the code-side extraction DID read can assert
      // "documented but not routed" — see the module doc. A tRPC tree counts as
      // read: its procedures are the code side of an app that has no route table.
      ...(codeOps.length + rpcOps.length > 0 ? { specOnly: true as const } : {}),
    })
  }

  const seeds = [...merged.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )
  return buildApiInterfaces(seeds)
}

/**
 * Document-file names an app serves its OpenAPI spec under. The base is
 * whatever precedes one of these.
 */
const OPENAPI_DOCUMENT_FILES = new Set(['openapi.json', 'swagger.json', 'openapi.yaml', 'openapi.yml'])

/**
 * The bases at which this tree serves an OpenAPI document AND answers everything
 * underneath — see THE META BASE RULE in the module note. Deduped, deterministic.
 */
function collectMetaBases(
  fileAnalyses: readonly FileAnalysis[],
  codeOps: readonly ApiInterfaceSeed[],
): string[] {
  const catchAllsByFile = new Map<string, Set<string>>()
  const prefixes = buildMountPrefixes(fileAnalyses)
  for (const fa of fileAnalyses) {
    const declared = fa.catchAllPrefixes ?? []
    if (declared.length === 0) continue
    const filePrefix = prefixes.get(fa.filePath) ?? ''
    catchAllsByFile.set(
      fa.filePath,
      new Set(declared.map((p) => (filePrefix ? composePath(filePrefix, p || '/') : p))),
    )
  }

  const bases = new Set<string>()
  for (const fa of fileAnalyses) {
    const filePrefix = prefixes.get(fa.filePath) ?? ''
    const catchAlls = catchAllsByFile.get(fa.filePath)
    if (!catchAlls) continue
    for (const route of fa.routeRegistrations ?? []) {
      if (route.httpMethod !== 'GET') continue
      const full = canonicalRoutePath(composePath(filePrefix, route.path))
      const segments = full.split('/')
      const last = segments[segments.length - 1]
      if (!last || !OPENAPI_DOCUMENT_FILES.has(last)) continue
      const base = segments.slice(0, -1).join('/')
      if (catchAlls.has(base)) bases.add(base)
    }
  }
  // `codeOps` is the composed view the rest of the derivation works from; a base
  // that no operation sits under is still a base (the document may be the only
  // registration there), so it is not filtered against it — the parameter keeps
  // the call sites honest about ordering.
  void codeOps
  return [...bases].sort()
}

/** Every `openapi` meta in the tree, at every qualifying base. */
function collectMetaOperations(
  fileAnalyses: readonly FileAnalysis[],
  codeOps: readonly ApiInterfaceSeed[],
): ApiInterfaceSeed[] {
  const metas = fileAnalyses.flatMap((fa) => fa.openApiRouteMetas ?? [])
  if (metas.length === 0) return []
  const bases = collectMetaBases(fileAnalyses, codeOps)
  if (bases.length === 0) return []

  const seeds: ApiInterfaceSeed[] = []
  for (const base of bases) {
    for (const meta of metas) {
      seeds.push({
        method: meta.httpMethod,
        path: canonicalRoutePath(composePath(base, meta.path)),
        ...(meta.label ? { label: meta.label } : {}),
      })
    }
  }
  return seeds
}

/**
 * Route registrations across every analyzed file, each path composed with its
 * file's full mount prefix. `ALL` routes are catch-alls, not operations a user
 * contract names — skipped.
 */
function collectRouteOperations(fileAnalyses: readonly FileAnalysis[]): ApiInterfaceSeed[] {
  const prefixes = buildMountPrefixes(fileAnalyses)
  const seeds: ApiInterfaceSeed[] = []
  for (const fa of fileAnalyses) {
    const prefix = prefixes.get(fa.filePath) ?? ''
    for (const route of fa.routeRegistrations ?? []) {
      if (route.httpMethod === 'ALL') continue
      seeds.push({
        method: route.httpMethod,
        path: canonicalRoutePath(composePath(prefix, route.path)),
        ...(route.handlerName ? { label: route.handlerName } : {}),
      })
    }
  }
  return seeds
}

/**
 * filePath → full mount prefix. A mount names a router; the router's file is
 * either the mounting file itself (locally defined) or the analyzed file the
 * router was imported from — resolved WITHOUT the module graph (the mapper has
 * per-file artifacts only) by matching exported name, tie-broken by the import
 * specifier's path suffix.
 *
 * Two facts about the mainstream layout the resolution has to survive:
 *
 *  - `app.use(prefix, middleware, router)` names more than the router, so the
 *    analyzer hands over every identifier as a CANDIDATE. A candidate whose file
 *    neither registers routes nor mounts routers is not a router — it is the
 *    middleware — and must not swallow the prefix. Were it allowed to, the real
 *    router would be left bare (`GET /{id}/analyses` for what is served at
 *    `/api/repos/{id}/analyses`) and every path folded into a fingerprint wrong.
 *
 *  - Mounts CHAIN: `app.use('/api/admin', adminRouter)` in one file and
 *    `adminRouter.use('/users', usersRouter)` in another compose to
 *    `/api/admin/users`, so each file's prefix is resolved by walking up to the
 *    file that mounts its mounter. A file mounting a router it declares itself
 *    ends the walk (there is nothing above it to inherit), as does a cycle.
 */
export function buildMountPrefixes(fileAnalyses: readonly FileAnalysis[]): Map<string, string> {
  /** mounted file → the prefix it is mounted at + the file that mounts it. */
  const edges = new Map<string, { prefix: string; mounter?: string }>()
  for (const fa of fileAnalyses) {
    for (const mount of fa.routerMounts ?? []) {
      const target = resolveMountTarget(fa, mount, fileAnalyses)
      if (!target || !isRouterModule(target)) continue
      if (edges.has(target.filePath)) continue
      edges.set(target.filePath, {
        prefix: mount.path,
        ...(target === fa ? {} : { mounter: fa.filePath }),
      })
    }
  }

  const prefixes = new Map<string, string>()
  for (const filePath of edges.keys()) prefixes.set(filePath, resolveFullPrefix(filePath, edges))
  return prefixes
}

/**
 * Is this file a router module — i.e. can a mount prefix mean anything for it? A
 * file that registers routes or mounts further routers is one; a middleware or a
 * plain helper named in the same `use()` call is not.
 */
function isRouterModule(fa: FileAnalysis): boolean {
  return (fa.routeRegistrations?.length ?? 0) > 0 || (fa.routerMounts?.length ?? 0) > 0
}

function resolveFullPrefix(
  filePath: string,
  edges: Map<string, { prefix: string; mounter?: string }>,
  seen: Set<string> = new Set(),
): string {
  const edge = edges.get(filePath)
  if (!edge) return ''
  if (seen.has(filePath)) return edge.prefix
  seen.add(filePath)
  const parent = edge.mounter ? resolveFullPrefix(edge.mounter, edges, seen) : ''
  return parent ? composePath(parent, edge.prefix) : edge.prefix
}

function resolveMountTarget(
  fa: FileAnalysis,
  mount: RouterMount,
  all: readonly FileAnalysis[],
): FileAnalysis | undefined {
  for (const imp of fa.imports) {
    const spec = imp.specifiers.find(
      (s) => s.alias === mount.routerName || (!s.alias && s.name === mount.routerName),
    )
    if (!spec) continue
    // Exactly one file may answer a specifier. Two that both could is not a
    // resolution — a guessed prefix names an address the server does not serve —
    // so an ambiguous specifier resolves to nothing, the same refusal the RPC
    // derivation makes for a router name two files define.
    const matches = all.filter((t) => t !== fa && fileMatchesImportSource(fa.filePath, t.filePath, imp.source))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) return undefined
  }
  const local =
    fa.functions.some((f) => f.name === mount.routerName) ||
    fa.exports.some((e) => e.name === mount.routerName)
  return local ? fa : undefined
}

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i

/**
 * Does `filePath` serve `source` as imported from `importerPath`? A relative
 * specifier resolves exactly against the importer's directory (`./routes/todos.js`
 * from `src/app.ts` → `src/routes/todos`); a bare/dotted one (Python
 * `.routes.todos`) falls back to path-suffix matching.
 *
 * Exported for the RPC derivation, which resolves a child ROUTER across files by
 * the same rule and must not grow a second opinion about what an import means.
 */
export function fileMatchesImportSource(importerPath: string, filePath: string, source: string): boolean {
  const fileBase = filePath.replace(SOURCE_EXTENSION, '')
  const bare = source.replace(SOURCE_EXTENSION, '')

  if (bare.startsWith('./') || bare.startsWith('../')) {
    const stack = importerPath.split('/').slice(0, -1)
    for (const part of bare.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    const resolved = stack.join('/')
    return fileBase === resolved || fileBase === `${resolved}/index`
  }

  const suffix = bare.replace(/^\.+/, '').replace(/\./g, '/').replace(/^\/+/, '')
  if (!suffix) return false
  const indexless = fileBase.replace(/\/index$/, '')
  if (indexless === suffix || indexless.endsWith(`/${suffix}`)) return true

  // A monorepo's own packages are imported by SCOPE — `@documenso/auth/server`
  // is `packages/auth/server` — and the scope segment maps to no directory, so
  // the suffix never matches with it attached. Retry without it. The caller
  // requires a unique match, which is what keeps this from claiming a
  // same-named file in another package.
  if (!suffix.startsWith('@')) return false
  const unscoped = suffix.split('/').slice(1).join('/')
  if (!unscoped) return false
  return indexless === unscoped || indexless.endsWith(`/${unscoped}`)
}

export function composePath(prefix: string, routePath: string): string {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const r = routePath.startsWith('/') ? routePath : `/${routePath}`
  const full = `${p}${r}`
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full || '/'
}
