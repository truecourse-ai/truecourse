/**
 * THE AUTHORING CONTEXT PACK — what the AST pass already knows about a web
 * place, handed to the session that authors it instead of being discarded.
 *
 * An authoring session (SPEC_GUARD_PLAN item 104) used to get a place id and an
 * address and nothing else, so it rediscovered by search what the derivation had
 * just computed. Measured on the first pilot: a documenso session spent six of
 * its fourteen turns guessing api names (`apiToken`, `api-token`, `create`,
 * `getMany`, `trpc`) against a surface where none of them exist, and a cal.diy
 * session spent six walking `page.tsx` → `availability-view.tsx` →
 * `ScheduleListItem.tsx` → `Button.tsx` to reach the accessible names. The
 * mapper knew the first hop of both walks and threw it away.
 *
 * Three facts per place, in the order they cost anything:
 *
 *  1. **The module that IS the place** — free. `WebPlaceSeed.filePath` already
 *     says it; `formWebResources` mints the id from the same seed, so the pair
 *     only needs carrying, not deriving.
 *  2. **The component closure** — one graph walk. The resolved import edges
 *     (`buildDependencyGraph`) turned into "the modules that render this screen".
 *  3. **The api effects** — the frontend→API join of AGENTIC_PIPELINE_PLAN §10.4:
 *     the requests the closure MAKES, joined to the api interface ids the catalog
 *     already carries, one hop through a named wrapper. What does not join is
 *     recorded as unjoined, never guessed — §10.4's `unknown` rule, and the rule
 *     the session's own prompt is held to.
 *
 * NOTHING HERE IS EVER STORED. Every field is a statement about the working tree
 * as it is right now: a file path is not surface-visible shape (the
 * `interfaceFingerprint` contract) and goes stale the moment a file moves, so
 * this pack lives exactly where `externalServices`, `database` and
 * `outboundRequests` live — derived per run, handed to the stage that needs it,
 * never written into the committed catalog.
 *
 * Pure, like the rest of this package: analyzer artifacts in, facts out. No
 * filesystem, no LLM. The two inputs it does not compute itself — the resolved
 * import edges and the derived api interfaces — arrive from the caller, because
 * resolution needs the TypeScript compiler (the analyzer's job) and the api ids
 * have to be the ones the catalog on disk carries (the catalog's job).
 */

import type { FileAnalysis, Interface, ModuleDependency } from '@truecourse/shared'
import type { WebPlace } from './web-tree.js'

/** What one place's session is told about the source behind it. */
export interface WebPlaceContext {
  /** The module that IS this place — its route file, repo-relative. */
  module: string
  /**
   * The first-party modules this place renders, nearest hop first, repo-relative.
   * Capped for context (see {@link MAX_RENDERS}); {@link closure} says how many
   * modules the walk actually reached.
   */
  renders: string[]
  /** How many first-party modules the walk reached, cap or no cap. */
  closure: number
  /** Ids of the derived api interfaces this place's requests join to. */
  apiEffects: string[]
  /**
   * The http requests the closure makes that joined to NO single api interface,
   * one line each with the reason. The honest half of the join: a session reading
   * "POST /api/v3/tokens — no api interface declares it" stops looking for an id
   * that does not exist.
   */
  unjoined: string[]
  /**
   * The RPC procedures the closure calls that the catalog does NOT define — the
   * remainder of the tRPC join, as dotted procedure names (`apiToken.create`).
   *
   * Since item 12 the api derivation composes a mounted tRPC tree into real
   * operations, so a procedure the catalog carries resolves to an api id and
   * lands in `apiEffects` like every other server effect. What stays here is
   * everything that did not resolve: a repo whose adapter states no mount, a
   * procedure on a router the composition could not reach, a client proxy the
   * derivation never saw. Naming them is still the useful fact — it is precisely
   * the fact whose absence cost the pilot six turns guessing `apiToken`,
   * `api-token`, `create`, `getMany`.
   */
  rpcCalls: string[]
}

export interface DeriveWebPlaceContextsInput {
  /** Absolute repo root — every path in the pack is relative to it. */
  repoRoot: string
  /** Place id → the seed it was minted from (`formWebResources().seeds`). */
  seeds: ReadonlyMap<string, WebPlace>
  fileAnalyses: readonly FileAnalysis[]
  /**
   * Resolved import edges — `buildDependencyGraph(fileAnalyses, repoRoot)`. A
   * `FileAnalysis.imports` entry carries the SPECIFIER (`./availability-view`,
   * `@calcom/ui`), and turning one into a file needs tsconfig paths, workspace
   * packages and extension probing; that resolution already exists and is not
   * re-implemented here.
   */
  dependencies: readonly ModuleDependency[]
  /** The derived api interfaces the effects join to — the catalog's own ids. */
  apiInterfaces: readonly Interface[]
  /** How many hops out from the route module the walk goes. Default {@link DEPTH}. */
  depth?: number
}

/**
 * How far the closure walks. Depth 3 is what the measured chains need: cal.diy's
 * `page.tsx` → `availability-view.tsx` → `ScheduleListItem.tsx` is three hops
 * before the accessible names appear, and documenso's route → view → table is
 * two. Deeper buys a design system's internals, which no task's locator comes
 * from.
 */
const DEPTH = 3

/** How many rendered modules the briefing names — the 5–8 that matter, with slack. */
const MAX_RENDERS = 12

/** A bound on the walk itself, so one screen importing a barrel cannot cost the run. */
const MAX_CLOSURE = 120

/** How many unjoined requests are worth stating before the list is noise. */
const MAX_UNJOINED = 8

/** How many RPC procedures a screen's briefing names — a busy screen calls a few. */
const MAX_RPC_CALLS = 12

/** Files whose extension means "this renders something a user can see". */
const COMPONENT_EXTENSIONS = ['.tsx', '.jsx', '.vue', '.svelte']

/**
 * The context pack, one entry per place whose module the tree names. A place
 * whose module is unknown gets NO entry — the session then works exactly as it
 * did before, which is the correct degradation for a fact nobody established.
 */
export function deriveWebPlaceContexts(
  input: DeriveWebPlaceContextsInput,
): Map<string, WebPlaceContext> {
  const analyses = new Map(input.fileAnalyses.map((analysis) => [analysis.filePath, analysis]))
  const edges = groupEdges(input.dependencies)
  const index = apiOperations(input.apiInterfaces)
  const depth = input.depth ?? DEPTH

  const contexts = new Map<string, WebPlaceContext>()
  for (const [placeId, seed] of input.seeds) {
    const module = seed.filePath
    if (!analyses.has(module)) continue
    const closure = walk(module, { analyses, edges, depth })
    contexts.set(placeId, {
      module: relative(input.repoRoot, module),
      renders: renderedModules(closure, analyses, seed.address).map((path) =>
        relative(input.repoRoot, path),
      ),
      closure: closure.length,
      ...join(closure, analyses, index),
    })
  }
  return contexts
}

// ---------------------------------------------------------------------------
// Tier 2 — the component closure
// ---------------------------------------------------------------------------

/** One module the walk reached, and what the module above it asked for. */
interface ClosureNode {
  path: string
  /** 0 = the place's own module. */
  hop: number
  /**
   * The names the importer imported from this module. Empty at hop 0, and empty
   * for a namespace/side-effect import — which is exactly the case where an api
   * effect cannot be attributed, so the emptiness is load-bearing.
   */
  names: Set<string>
}

interface WalkInput {
  analyses: ReadonlyMap<string, FileAnalysis>
  edges: ReadonlyMap<string, readonly ModuleDependency[]>
  depth: number
}

/**
 * The modules a place renders, breadth-first from its route module.
 *
 * **Barrels are followed by NAME.** A monorepo screen imports `Button` from
 * `@calcom/ui`, whose index re-exports two hundred components; following every
 * edge of that barrel buys the whole design system and pushes the modules that
 * actually render the screen past every cap. So a module whose exports are ALL
 * re-exports is treated as the pass-through it is: only the edges carrying a name
 * the importer actually asked for are followed. Nothing is guessed away — the
 * names come from the import statement.
 *
 * Deterministic: edges are visited in target order, and a module is entered once.
 */
function walk(module: string, input: WalkInput): ClosureNode[] {
  const first: ClosureNode = { path: module, hop: 0, names: new Set() }
  const reached = new Map<string, ClosureNode>([[module, first]])
  const queue: ClosureNode[] = [first]

  for (let i = 0; i < queue.length && reached.size < MAX_CLOSURE; i++) {
    const node = queue[i]
    if (node.hop >= input.depth) continue
    const analysis = input.analyses.get(node.path)
    const passThrough = analysis ? isBarrel(analysis) : false
    for (const edge of input.edges.get(node.path) ?? []) {
      // A pass-through module contributes nothing of its own; following only the
      // names the importer asked for keeps a barrel a hop rather than a horizon.
      if (passThrough && node.names.size > 0 && !edge.importedNames.some((name) => node.names.has(name))) {
        continue
      }
      const seen = reached.get(edge.target)
      if (seen) {
        // A module reached twice keeps its first (nearest) hop, and collects the
        // names of every importer — attribution asks "did anyone ask for this".
        for (const name of edge.importedNames) seen.names.add(name)
        continue
      }
      if (reached.size >= MAX_CLOSURE) break
      const next: ClosureNode = {
        path: edge.target,
        hop: node.hop + 1,
        names: new Set(edge.importedNames),
      }
      reached.set(edge.target, next)
      queue.push(next)
    }
  }
  return [...reached.values()]
}

/** Import edges by importing file, each file's edges in target order. */
function groupEdges(dependencies: readonly ModuleDependency[]): Map<string, ModuleDependency[]> {
  const bySource = new Map<string, ModuleDependency[]>()
  for (const dependency of dependencies) {
    const list = bySource.get(dependency.source)
    if (list) list.push(dependency)
    else bySource.set(dependency.source, [dependency])
  }
  for (const list of bySource.values()) {
    list.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
  }
  return bySource
}

/** A module that only re-exports: `export { Button } from './button'`, nothing of its own. */
function isBarrel(analysis: FileAnalysis): boolean {
  return (
    analysis.exports.length > 0 &&
    analysis.exports.every((statement) => Boolean(statement.source)) &&
    analysis.functions.length === 0
  )
}

/**
 * The modules worth NAMING: the views of the closure, the screen's own feature
 * first.
 *
 * Barrels are dropped (a re-export declares no control) and so is everything
 * whose extension says it is not a view — an api client and a hook are in the
 * closure because the JOIN needs them, but a session reading for accessible
 * names has no use for their paths. A closure with no view file at all falls
 * back to its first hop, so a repo whose components live in `.js` is told
 * something true rather than nothing.
 *
 * The ORDER is what makes a 12-line list useful: a path carrying one of the
 * address's own words (`availability-view.tsx` for `/availability`) comes before
 * the app shell and the design-system primitives every screen imports. Hop
 * distance breaks the tie, because it is the only other thing the graph says.
 */
function renderedModules(
  closure: readonly ClosureNode[],
  analyses: ReadonlyMap<string, FileAnalysis>,
  address: string,
): string[] {
  const words = addressWords(address)
  const rank = (node: ClosureNode): number => (matchesAddress(node.path, words) ? 0 : 1)
  const ordered = closure
    .filter((node) => node.hop > 0)
    .sort(
      (a, b) => rank(a) - rank(b) || a.hop - b.hop || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
  const views = ordered.filter((node) => {
    const analysis = analyses.get(node.path)
    if (analysis && isBarrel(analysis)) return false
    return COMPONENT_EXTENSIONS.some((extension) => node.path.endsWith(extension))
  })
  const kept = views.length > 0 ? views : ordered.filter((node) => node.hop === 1)
  return kept.slice(0, MAX_RENDERS).map((node) => node.path)
}

/** The address's own words — static segments only, short ones dropped as noise. */
function addressWords(address: string): string[] {
  return address
    .split('/')
    .filter((segment) => segment.length >= 3 && !segment.includes('{'))
    .map((segment) => segment.toLowerCase())
}

function matchesAddress(filePath: string, words: readonly string[]): boolean {
  const lower = filePath.toLowerCase()
  return words.some((word) => lower.includes(word))
}

// ---------------------------------------------------------------------------
// Tier 3 — the frontend→API join (§10.4)
// ---------------------------------------------------------------------------

/** One derived api operation, indexed by what a frontend request can be compared to. */
interface ApiOperation {
  id: string
  method: string
  /** Path segments with every parameter slot anonymized. */
  slots: string[]
}

/** The api catalog indexed the two ways a frontend call can name an operation. */
interface ApiIndex {
  operations: ApiOperation[]
  /** Dotted procedure → api interface id, for the entries item 12 derived. */
  procedures: Map<string, string>
}

function apiOperations(interfaces: readonly Interface[]): ApiIndex {
  const operations: ApiOperation[] = []
  const procedures = new Map<string, string>()
  for (const iface of interfaces) {
    if (iface.type !== 'api') continue
    // The procedure index is the RPC join key (item 12): the catalog says which
    // id `viewer.bookings.get` is, so the client call resolves by NAME and never
    // by the `?input=`-encoded URL it is actually sent as.
    if (iface.procedure && !procedures.has(iface.procedure)) procedures.set(iface.procedure, iface.id)
    const entry = iface.entry as { method?: string; path?: string }
    if (!entry.method || !entry.path) continue
    operations.push({ id: iface.id, method: entry.method.toUpperCase(), slots: slots(entry.path) })
  }
  return { operations, procedures }
}

/**
 * The api interfaces a place's requests reach, and the requests that reach none.
 *
 * **Which requests are the place's.** Every http call in the place's own module,
 * and — the one-hop wrapper resolution of §10.4 — every http call inside a
 * FUNCTION (or a class) somebody in the closure imported BY NAME. That second
 * rule is what makes the join usable on a real app, where the page calls
 * `createToken()` and the request lives in an api-client module; and it is what
 * keeps a shared client from attaching its two hundred endpoints to every screen
 * that imports one of them. A call nobody asked for by name is not this place's
 * effect, and is silently not attributed — never listed as unjoined, because the
 * honest statement about it is that it is not here at all.
 */
function join(
  closure: readonly ClosureNode[],
  analyses: ReadonlyMap<string, FileAnalysis>,
  index: ApiIndex,
): Pick<WebPlaceContext, 'apiEffects' | 'unjoined' | 'rpcCalls'> {
  const effects = new Set<string>()
  const unjoined = new Set<string>()
  const rpcCalls = new Set<string>()

  for (const node of closure) {
    const analysis = analyses.get(node.path)
    if (!analysis) continue

    // The RPC half. A procedure the catalog defines (item 12: a mounted tRPC
    // tree composed into operations) resolves to that api id and joins like any
    // other server effect; one it does not is still named, because "this screen
    // calls `apiToken.create` and nothing maps it" is the fact that stops a
    // session guessing ids until its budget runs out.
    const proxies = rpcProxies(analysis)
    for (const call of analysis.calls) {
      const procedure = rpcProcedure(call.callee, proxies)
      if (!procedure) continue
      if (node.hop > 0 && !requestedByName(call.location.startLine, analysis, node.names)) continue
      const id = index.procedures.get(procedure)
      if (id) effects.add(id)
      else rpcCalls.add(procedure)
    }

    for (const call of analysis.httpCalls) {
      if (node.hop > 0 && !requestedByName(call.location.startLine, analysis, node.names)) continue
      const path = requestPath(call.url)
      if (!path) {
        // A URL the source builds at runtime. Stated, because "the app requests
        // something here and nobody could say what" is exactly what a session
        // needs to know before it omits `apiEffects`.
        //
        // Unless it is not a URL at all: the analyzer's http matcher keys on
        // callee shape (`.get(…)`, `.post(…)`), so a cache read or a `Map.get`
        // arrives here with `parentId` for a url. A bare identifier is that. A
        // path separator or an interpolation means the source really did build a
        // URL here; anything else would be inventing a request to report.
        if (/[/:]|\$\{/.test(call.url)) {
          unjoined.add(`${call.method} ${clip(call.url)} — the request URL is built at runtime`)
        }
        continue
      }
      const matched = match(call.method, path, index.operations)
      if (matched.length === 1) effects.add(matched[0].id)
      else if (matched.length === 0) unjoined.add(`${call.method} ${path} — no api interface declares it`)
      else unjoined.add(`${call.method} ${path} — matches ${matched.length} api interfaces`)
    }
  }

  return {
    apiEffects: [...effects].sort(),
    unjoined: capped(unjoined, MAX_UNJOINED),
    rpcCalls: capped(rpcCalls, MAX_RPC_CALLS),
  }
}

/** A sorted list with its tail counted rather than silently dropped. */
function capped(values: ReadonlySet<string>, max: number): string[] {
  const sorted = [...values].sort()
  if (sorted.length <= max) return sorted
  return [...sorted.slice(0, max), `… ${sorted.length - max} more`]
}

/**
 * The procedure a tRPC client call names, or `null` for a call that is not one —
 * NAMESPACE-FREE and dotted (`viewer.bookings.get`), which is the form the api
 * derivation composes and therefore the only form the two sides can be compared
 * in. The client's own proxy name is a local alias and says nothing about which
 * procedure was called.
 *
 * The gate is the PROXY (see {@link rpcProxies}) plus one of two shapes: the
 * callee ends in a react-query hook or an imperative verb (`api.post.create.
 * useMutation`), or it names at least two segments below the proxy
 * (`trpc.apiToken.create`, the `await` form). One bare segment under a proxy is
 * a property read, not a procedure call.
 */
function rpcProcedure(callee: string, proxies: ReadonlySet<string>): string | null {
  const segments = callee.split('.')
  const head = segments[0]
  if (head === undefined || !proxies.has(head)) return null
  const rest = segments.slice(1)
  const last = rest[rest.length - 1]
  const invoked = last !== undefined && RPC_TAILS.has(last)
  const body = invoked ? rest.slice(0, -1) : rest
  if (body.length === 0 || (!invoked && body.length < 2)) return null
  return body.join('.')
}

/**
 * The identifiers this file uses as a tRPC CLIENT PROXY.
 *
 * `trpc` is one by name — the ecosystem's own convention, and the gate this join
 * shipped with. The rest have to be proven, and the proof available in a
 * per-file artifact is the IMPORT: a t3 app calls its proxy `api`
 * (`import { api } from "~/trpc/react"`) and a callee gate keyed on the literal
 * word `trpc` matches nothing there — which is why every t3 screen's procedures
 * used to read as `toast.success`-grade noise. So an imported name counts when
 * its specifier is a tRPC client: `@trpc/react-query` / `@trpc/client` /
 * `@trpc/next` (where `createTRPCReact` / `createTRPCProxyClient` come from), or
 * a first-party module whose path NAMES trpc, which is where every app puts the
 * proxy those factories return.
 *
 * Deliberately not proven from a `createTRPCReact()` call in this file: that
 * call sits in the client module, and a per-file artifact carries no binding
 * from a call to the const it initializes. The import at the USE site is the
 * fact that is actually available, and it is the stronger one.
 */
function rpcProxies(analysis: FileAnalysis): Set<string> {
  const proxies = new Set<string>(['trpc'])
  for (const imp of analysis.imports) {
    if (!TRPC_CLIENT_SOURCE.test(imp.source)) continue
    for (const specifier of imp.specifiers) proxies.add(specifier.alias ?? specifier.name)
  }
  return proxies
}

/** A module specifier that names trpc: `@trpc/react-query`, `~/trpc/react`, `../utils/trpc`. */
const TRPC_CLIENT_SOURCE = /(^|[/@._-])trpc([/._-]|$)/i

/** The hooks and verbs a tRPC procedure is invoked THROUGH, never part of its name. */
const RPC_TAILS = new Set([
  'useMutation',
  'useQuery',
  'useSuspenseQuery',
  'useInfiniteQuery',
  'useSuspenseInfiniteQuery',
  'useUtils',
  'mutate',
  'mutateAsync',
  'query',
  'fetch',
  'prefetch',
  'invalidate',
  'ensureData',
  'setData',
])

/**
 * Is this call inside something the importer named? The enclosing function is the
 * innermost declaration whose lines contain the call; a class method counts when
 * the CLASS was imported, which is how an `ApiClient` reads.
 */
function requestedByName(
  line: number,
  analysis: FileAnalysis,
  names: ReadonlySet<string>,
): boolean {
  if (names.size === 0) return false
  for (const fn of analysis.functions) {
    if (contains(fn.location, line) && names.has(fn.name)) return true
  }
  for (const cls of analysis.classes) {
    if (!names.has(cls.name)) continue
    for (const method of cls.methods) {
      if (contains(method.location, line)) return true
    }
  }
  return false
}

function contains(location: { startLine: number; endLine: number }, line: number): boolean {
  return line >= location.startLine && line <= location.endLine
}

/**
 * The api operations one request could be. An exact path match is the answer when
 * there is one; otherwise a request whose TAIL is an operation's whole path
 * (`/api/v2/schedules` for a `/v2/schedules` operation) matches, because the
 * frontend writes the mount prefix the route table does not. Two segments are
 * required for that fallback: a one-segment operation would match half the app.
 */
function match(method: string, path: string, operations: readonly ApiOperation[]): ApiOperation[] {
  const requested = slots(path)
  const sameMethod = operations.filter((operation) => operation.method === method.toUpperCase())
  const exact = sameMethod.filter((operation) => same(operation.slots, requested))
  if (exact.length > 0) return exact
  return sameMethod.filter(
    (operation) =>
      operation.slots.length >= 2 &&
      operation.slots.length <= requested.length &&
      same(operation.slots, requested.slice(requested.length - operation.slots.length)),
  )
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

/** Path segments with every parameter spelling — `{id}`, `:id`, `[id]`, `${x}` — anonymized. */
function slots(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.includes('{') || segment.startsWith(':') || segment.includes('[') ? '{}' : segment))
}

/**
 * The path a request asks for, or `null` when the source does not state one.
 *
 * The analyzer hands template strings over verbatim (`` `${base}/schedules/${id}` ``),
 * so interpolations become slots and a leading interpolation — the base-URL
 * idiom — is dropped. A URL that is still not rooted after that is a request
 * nobody can name: `null`, not a guess.
 */
function requestPath(url: string): string | null {
  let text = url.trim().replace(/^`|`$/g, '')
  text = text.replace(/\$\{[^}]*\}/g, '{}')
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^\s]*)?$/i.exec(text)
  if (absolute) text = absolute[1] ?? '/'
  text = text.split(/[?#]/)[0]
  // `${API_BASE}/schedules` — the base is a slot, and the path is what follows it.
  while (text.startsWith('{}')) text = text.slice(2)
  if (!text.startsWith('/')) return null
  const trimmed = text.length > 1 ? text.replace(/\/+$/, '') : text
  return `/${slots(trimmed).join('/')}`
}

function relative(repoRoot: string, filePath: string): string {
  if (!filePath.startsWith(repoRoot)) return filePath
  return filePath.slice(repoRoot.length).replace(/^[/\\]/, '').split('\\').join('/')
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat
}
