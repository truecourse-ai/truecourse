/** Deterministic, invocation-local author lookup. No source or execution access. */
import { createHash } from 'node:crypto'
import type { GuardFlow, Interface, InterfaceResource, InterfaceState } from '@truecourse/shared'
import { buildResourceHints } from './grounding.js'

export const AUTHOR_CATALOG_VERSION = 'web-author-catalog-v4'
export const AUTHOR_TOOL_RESULT_CHARS = 12_000
export const AUTHOR_INITIAL_BYTES = 120_000
export const AUTHOR_SUMMARY_CHARS = 1_500
export interface CatalogSearch { query: string; purpose?: 'task' | 'control'; resource?: string; limit?: number; cursor?: string }
export interface CatalogIds { ids: string[]; cursor?: string }
export interface CatalogGet extends CatalogIds { includeResources?: boolean }
export interface CatalogReport { content: string; isError?: boolean }
export interface AuthorCatalogSummary { id?: string; title?: string; entry?: Interface['entry']; purpose?: string; at?: string; to?: string; startingState?: string; endState?: string; omittedFields: string[]; error?: string; identityHash?: string; instruction?: string }
export interface AuthorCatalog {
  fingerprint: string
  search(input: CatalogSearch): CatalogReport
  get(input: CatalogGet): CatalogReport
  getResources(input: CatalogIds): CatalogReport
  getStates(input: CatalogIds): CatalogReport
  candidates(own: readonly Interface[], terms: string): AuthorCatalogSummary[]
  /**
   * ONE entry's fingerprint — an action, or a resource a `get` returns beside
   * one. `null` when the id has left the catalog. It is what the settle compare
   * folds for the entries a flow's session actually read, so a screen the
   * session never asked for cannot re-open it.
   */
  entryFingerprint(id: string): string | null
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const hash = (v: unknown): string => createHash('sha256').update(stable(v)).digest('hex')
const error = (code: string): CatalogReport => ({ content: JSON.stringify({ error: code, instruction: 'Retrieval failed; do not infer absent product behavior. Resolve retrieval before authoring dependent steps.' }), isError: true })
function summary(i: Interface) {
  return { id: i.id, title: i.title, entry: i.entry, purpose: i.purpose, at: i.at, to: i.to, startingState: i.startingState, endState: i.endState }
}
/** Optional metadata is omitted whole, never clipped. Search still uses the full metadata. */
function boundedSummary(full: ReturnType<typeof summary>): AuthorCatalogSummary {
  // The fetch tool accepts at most 200 characters per ID. A larger identity cannot
  // be used through that contract; report it without blocking later search rows.
  if (full.id.length > 200) return {
    error: 'oversized-interface-id', identityHash: hash(full.id),
    omittedFields: ['id', 'all metadata'],
    instruction: 'The action ID exceeds the 200-character retrieval limit. Dependent authoring is blocked; continue paging to discover other actions.',
  }
  const optional = Object.entries(full).filter(([key, value]) => key !== 'id' && value !== undefined)
  const result: AuthorCatalogSummary = { id: full.id, omittedFields: ['steps', 'resource readables; use get_interfaces', ...optional.map(([key]) => key)] }
  for (const [key, value] of optional) {
    const proposed = { ...result, [key]: value, omittedFields: result.omittedFields.filter(field => field !== key) }
    if (JSON.stringify(proposed).length <= AUTHOR_SUMMARY_CHARS) Object.assign(result, proposed)
  }
  return structuredClone(result)
}
interface CatalogItem { id: string; path: (string | number)[]; value: unknown }
// Leave room for five maximal action IDs, the continuation and page metadata.
const COMPACT_ITEM_CHARS = AUTHOR_TOOL_RESULT_CHARS - 2_000
/** Ordinary definitions stay whole. Split oversized objects only, never clip a scalar. */
function fields(id: string, value: unknown, path: (string | number)[]): CatalogItem[] {
  const item = { id, path, value }
  if (JSON.stringify(item).length <= COMPACT_ITEM_CHARS) return [item]
  if (value && typeof value === 'object' && Object.keys(value).length) {
    return Object.entries(value).flatMap(([key, v]) => fields(id, v, [...path, Array.isArray(value) ? Number(key) : key]))
  }
  return [item]
}
export function createAuthorCatalog(interfaces: readonly Interface[], resources?: Record<string, InterfaceResource[]>, states: readonly InterfaceState[] = []): AuthorCatalog {
  // Clone once: callers cannot mutate a running snapshot or its continuation keys.
  const entries = structuredClone(interfaces.filter(i => i.type === 'web')).sort((a, b) => a.id.localeCompare(b.id))
  const registry = structuredClone(resources ?? {})
  const stateRegistry = structuredClone([...states]).sort((a, b) => a.id.localeCompare(b.id))
  const resourceById = new Map((registry.web ?? []).map(resource => [resource.id, resource]))
  const stateById = new Map(stateRegistry.map(state => [state.id, state]))
  const payloads = new Map(entries.map(i => [i.id, { interface: i, resources: buildResourceHints([i], registry) }]))
  const reachableResources = [...new Map([...payloads.values()].flatMap(p => p.resources).map(r => [r.id, r])).values()].sort((a, b) => a.id.localeCompare(b.id))
  const fingerprint = hash([AUTHOR_CATALOG_VERSION, entries, reachableResources, stateRegistry])
  // Per-entry fingerprints for the settle compare. Resources go in first so an
  // action wins a shared id: an action is what a scenario is authored against.
  const entryFingerprints = new Map<string, string>([
    ...reachableResources.map((r) => [r.id, hash([AUTHOR_CATALOG_VERSION, r])] as const),
    ...entries.map((i) => [i.id, hash([AUTHOR_CATALOG_VERSION, i])] as const),
  ])
  const summaries = entries.map(summary)
  function page(items: unknown[], binding: unknown, limit: number, cursor?: string, metadata?: (end: number) => object): CatalogReport {
    // Bind to exactly the requested data and projection. Unrelated peer writes
    // must not make the caller re-read unchanged definitions from page one.
    const key = hash([AUTHOR_CATALOG_VERSION, binding, items])
    let start = 0
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        if (parsed.key !== key || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0 || parsed.offset >= items.length) return error('invalid-or-stale-cursor')
        start = parsed.offset
      } catch { return error('invalid-or-stale-cursor') }
    }
    const render = (selected: unknown[], end: number): string => JSON.stringify({ snapshot: key, total: items.length, offset: start, items: selected, ...metadata?.(end), complete: end === items.length, omittedFields: end === items.length ? [] : ['remaining items; continue with nextCursor'], ...(end < items.length ? { nextCursor: Buffer.from(JSON.stringify({ key, offset: end })).toString('base64url') } : {}) })
    const selected: unknown[] = []
    for (let n = start; n < items.length && selected.length < limit; n++) {
      if (render([...selected, items[n]], n + 1).length > AUTHOR_TOOL_RESULT_CHARS) {
        if (!selected.length) return error('oversized-indivisible-field')
        break
      }
      selected.push(items[n])
    }
    return { content: render(selected, start + selected.length) }
  }
  const ranked = (query: string): ReturnType<typeof summary>[] => {
    const q = query.trim().toLowerCase()
    const terms = q.split(/\s+/).filter(Boolean)
    return summaries.map(s => {
      const text = stable(s).toLowerCase()
      const exact = s.id.toLowerCase() === q || Object.values(s.entry).some(v => typeof v === 'string' && v.toLowerCase() === q)
      return { s, score: exact ? 10000 : terms.reduce((n, t) => n + Number(text.includes(t)), 0) }
    }).filter(r => !q || r.score > 0).sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id)).map(r => r.s)
  }
  const validIds = (ids: string[], available: ReadonlyMap<string, unknown>) => ids.length >= 1 && ids.length <= 5
    && new Set(ids).size === ids.length && ids.every(id => id.length >= 1 && id.length <= 200 && available.has(id))
  function definitions(input: CatalogIds, kind: 'resources' | 'states', available: ReadonlyMap<string, unknown>): CatalogReport {
    if (!validIds(input.ids, available)) return error(`unknown-or-invalid-${kind === 'resources' ? 'resource' : 'state'}-ids`)
    if ((input.cursor?.length ?? 0) > 1000) return error('invalid-or-stale-cursor')
    return page(input.ids.flatMap(id => fields(id, available.get(id), [kind, id])), { kind, ids: input.ids }, Infinity, input.cursor)
  }
  return {
    fingerprint,
    search(input) {
      if (input.query.length > 500 || (input.resource?.length ?? 0) > 200 || (input.cursor?.length ?? 0) > 1000 || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20))) return error('invalid-search-input')
      const results = ranked(input.query).filter(s => (!input.purpose || s.purpose === input.purpose) && (!input.resource || payloads.get(s.id)!.resources.some(r => r.id === input.resource)))
      return page(results.map(boundedSummary), { kind: 'search', query: input.query, purpose: input.purpose, resource: input.resource, limit: input.limit ?? 8 }, input.limit ?? 8, input.cursor)
    },
    get(input) {
      if (!validIds(input.ids, payloads)) return error('unknown-or-invalid-interface-ids')
      if (input.includeResources !== undefined && typeof input.includeResources !== 'boolean') return error('invalid-get-input')
      if ((input.cursor?.length ?? 0) > 1000) return error('invalid-or-stale-cursor')
      // Every requested action precedes optional resource pages, so a large
      // resource on the first action cannot hide the second action's steps.
      const actionEnds: { id: string; end: number }[] = []
      const items: CatalogItem[] = []
      for (const id of input.ids) {
        items.push(...fields(id, payloads.get(id)!.interface, ['interface']))
        actionEnds.push({ id, end: items.length })
      }
      const includeResources = input.includeResources ?? true
      if (includeResources) {
        const requestedResources = new Map(input.ids.flatMap(id => payloads.get(id)!.resources).map(resource => [resource.id, resource]))
        for (const resource of [...requestedResources.values()].sort((a, b) => a.id.localeCompare(b.id))) {
          items.push(...fields(resource.id, resource, ['resources', resource.id]))
        }
      }
      return page(items, { kind: 'get', ids: input.ids, includeResources }, Infinity, input.cursor,
        end => ({ actionCompleteIds: actionEnds.filter(action => action.end <= end).map(action => action.id) }))
    },
    getResources(input) { return definitions(input, 'resources', resourceById) },
    getStates(input) { return definitions(input, 'states', stateById) },
    entryFingerprint(id) { return entryFingerprints.get(id) ?? null },
    candidates(own, terms) {
      const ids = new Set(own.map(i => i.id))
      return ranked(`${terms} ${own.map(i => [i.title, i.at, i.to, i.startingState, i.endState].filter(Boolean).join(' ')).join(' ')}`).filter(s => !ids.has(s.id)).slice(0, 6).map(boundedSummary)
    },
  }
}

/** One task's recording view of the shared catalog — see {@link recordCatalogReads}. */
export interface CatalogReadLog {
  /** The catalog to hand the session: the same reads, recorded. */
  catalog: AuthorCatalog
  /** The entry ids served so far, sorted. */
  ids(): string[]
  /** Adopt the read-set a cached result was stored with, so a cache HIT records
   *  what the live session would have. */
  adopt(ids: readonly string[]): void
}

/**
 * Record what one authoring session is SERVED out of the shared catalog. The
 * catalog runs once per run over every browser screen, and a session reaches
 * whichever of them it searches for, so the only honest per-flow input is the
 * set of entries its `search` and `get` calls actually returned — read back off
 * the rendered pages, which are the session's whole view of the catalog. The
 * flow's settle compare then folds those entries alone.
 */
export function recordCatalogReads(catalog: AuthorCatalog): CatalogReadLog {
  const seen = new Set<string>()
  const record = (report: CatalogReport): CatalogReport => {
    if (!report.isError) for (const id of servedIds(report.content)) seen.add(id)
    return report
  }
  return {
    catalog: {
      ...catalog,
      search: (input) => record(catalog.search(input)),
      get: (input) => record(catalog.get(input)),
    },
    ids: () => [...seen].sort(),
    adopt: (ids) => { for (const id of ids) seen.add(id) },
  }
}

/** The entry ids one rendered page carries; none from anything but a page. */
function servedIds(content: string): string[] {
  let page: unknown
  try { page = JSON.parse(content) } catch { return [] }
  if (!page || typeof page !== 'object' || !('items' in page) || !Array.isArray(page.items)) return []
  return page.items.flatMap((item: unknown) =>
    item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? [item.id] : [])
}

/**
 * A read-set as the settle compare folds it: each entry id with its CURRENT
 * fingerprint, `absent` for an id the catalog no longer holds. An entry that is
 * gone moves the component, because the flow authored against something that
 * has left the product.
 */
export function catalogReadMaterial(catalog: AuthorCatalog, ids: readonly string[]): string[] {
  return [...ids].sort().map((id) => `${id}:${catalog.entryFingerprint(id) ?? 'absent'}`)
}

/** The setup-action shortlist a web briefing offers, ranked against the flow. */
export function webSetupCandidates(catalog: AuthorCatalog, own: readonly Interface[], flow: GuardFlow): AuthorCatalogSummary[] {
  return catalog.candidates(own, JSON.stringify(flow))
}

/**
 * The web arm of a worker's cache key: everything the authoring session is
 * handed BEFORE it reads anything — its own plan's scoped resources and the
 * shortlist the briefing offers. The rest of the catalog stays out, so one
 * screen's re-authored readables no longer re-key every web flow; what a
 * session then reaches for through its tools is recorded on the flow instead
 * (see {@link recordCatalogReads}). The accepted risk is that a cached result
 * can predate an entry the session would now find through `search` — and the
 * worker key is only consulted after the settle compare already re-opened the
 * flow.
 */
export function webAuthorKeyMaterial(
  catalog: AuthorCatalog,
  own: readonly Interface[],
  flow: GuardFlow,
  resources?: Record<string, InterfaceResource[]>,
): string {
  return hash([AUTHOR_CATALOG_VERSION, scopedAuthorResources(own, resources), webSetupCandidates(catalog, own, flow)])
}

/** Keep resource identity and only readables explicitly referenced by selected action data. */
export function scopedAuthorResources(own: readonly Interface[], resources?: Record<string, InterfaceResource[]>): InterfaceResource[] {
  const actionText = stable(own)
  const referenced = new Set(actionText.match(/[A-Za-z0-9_/-]+/g) ?? [])
  return buildResourceHints(own, resources).map(resource => {
    const { readables, ...identity } = resource
    if (!readables) return identity
    const selected = Object.fromEntries(Object.entries(readables).map(([kind, rows]) => [kind, rows.filter(row => (row.id && referenced.has(row.id)) || ('control' in row && actionText.includes(stable(row.control))) || ('element' in row && actionText.includes(stable(row.element))))]))
    const present = Object.fromEntries(Object.entries(selected).filter(([, rows]) => rows.length > 0))
    return Object.keys(present).length ? { ...identity, readables: present } : identity
  })
}
