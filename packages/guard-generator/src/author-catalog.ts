/** Deterministic, invocation-local author lookup. No source or execution access. */
import { createHash } from 'node:crypto'
import type { Interface, InterfaceResource } from '@truecourse/shared'
import { buildResourceHints } from './grounding.js'

export const AUTHOR_CATALOG_VERSION = 'web-author-catalog-v3'
export const AUTHOR_TOOL_RESULT_CHARS = 12_000
export const AUTHOR_INITIAL_BYTES = 120_000
export const AUTHOR_SUMMARY_CHARS = 1_500
export interface CatalogSearch { query: string; purpose?: 'task' | 'control'; resource?: string; limit?: number; cursor?: string }
export interface CatalogGet { ids: string[]; cursor?: string }
export interface CatalogReport { content: string; isError?: boolean }
export interface AuthorCatalogSummary { id?: string; title?: string; entry?: Interface['entry']; purpose?: string; at?: string; to?: string; startingState?: string; endState?: string; omittedFields: string[]; error?: string; identityHash?: string; instruction?: string }
export interface AuthorCatalog {
  fingerprint: string
  search(input: CatalogSearch): CatalogReport
  get(input: CatalogGet): CatalogReport
  candidates(own: readonly Interface[], terms: string): AuthorCatalogSummary[]
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
/** Page at complete field boundaries. Indexed paths preserve array order and permit lossless reconstruction. */
function fields(value: unknown, path: (string | number)[] = []): { path: (string | number)[]; value: unknown }[] {
  if (value && typeof value === 'object' && Object.keys(value).length) return Object.entries(value).flatMap(([key, v]) => fields(v, [...path, Array.isArray(value) ? Number(key) : key]))
  return [{ path, value }]
}
export function createAuthorCatalog(interfaces: readonly Interface[], resources?: Record<string, InterfaceResource[]>): AuthorCatalog {
  // Clone once: callers cannot mutate a running snapshot or its continuation keys.
  const entries = structuredClone(interfaces.filter(i => i.type === 'web')).sort((a, b) => a.id.localeCompare(b.id))
  const registry = structuredClone(resources ?? {})
  const payloads = new Map(entries.map(i => [i.id, { interface: i, resources: buildResourceHints([i], registry) }]))
  const reachableResources = [...new Map([...payloads.values()].flatMap(p => p.resources).map(r => [r.id, r])).values()].sort((a, b) => a.id.localeCompare(b.id))
  const fingerprint = hash([AUTHOR_CATALOG_VERSION, entries, reachableResources])
  const summaries = entries.map(summary)
  function page(items: unknown[], binding: unknown, limit: number, cursor?: string, metadata?: (end: number) => object): CatalogReport {
    const key = hash([fingerprint, binding])
    let start = 0
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        if (parsed.key !== key || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0 || parsed.offset >= items.length) return error('invalid-or-stale-cursor')
        start = parsed.offset
      } catch { return error('invalid-or-stale-cursor') }
    }
    const render = (selected: unknown[], end: number): string => JSON.stringify({ snapshot: fingerprint, total: items.length, offset: start, items: selected, ...metadata?.(end), complete: end === items.length, omittedFields: end === items.length ? [] : ['remaining items; continue with nextCursor'], ...(end < items.length ? { nextCursor: Buffer.from(JSON.stringify({ key, offset: end })).toString('base64url') } : {}) })
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
  return {
    fingerprint,
    search(input) {
      if (input.query.length > 500 || (input.resource?.length ?? 0) > 200 || (input.cursor?.length ?? 0) > 1000 || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20))) return error('invalid-search-input')
      const results = ranked(input.query).filter(s => (!input.purpose || s.purpose === input.purpose) && (!input.resource || payloads.get(s.id)!.resources.some(r => r.id === input.resource)))
      return page(results.map(boundedSummary), { kind: 'search', query: input.query, purpose: input.purpose, resource: input.resource, limit: input.limit ?? 8 }, input.limit ?? 8, input.cursor)
    },
    get(input) {
      if (input.ids.length < 1 || input.ids.length > 5 || new Set(input.ids).size !== input.ids.length || input.ids.some(id => !payloads.has(id))) return error('unknown-or-invalid-interface-ids')
      if ((input.cursor?.length ?? 0) > 1000) return error('invalid-or-stale-cursor')
      // Every requested action precedes optional resource pages, so a large
      // resource on the first action cannot hide the second action's steps.
      const actionEnds: { id: string; end: number }[] = []
      const items: { id: string; path: (string | number)[]; value: unknown }[] = []
      for (const id of input.ids) {
        items.push(...fields(payloads.get(id)!.interface, ['interface']).map(f => ({ id, ...f })))
        actionEnds.push({ id, end: items.length })
      }
      for (const id of input.ids) items.push(...fields(payloads.get(id)!.resources, ['resources']).map(f => ({ id, ...f })))
      return page(items, { kind: 'get', ids: input.ids }, Infinity, input.cursor,
        end => ({ actionCompleteIds: actionEnds.filter(action => action.end <= end).map(action => action.id) }))
    },
    candidates(own, terms) {
      const ids = new Set(own.map(i => i.id))
      return ranked(`${terms} ${own.map(i => [i.title, i.at, i.to, i.startingState, i.endState].filter(Boolean).join(' ')).join(' ')}`).filter(s => !ids.has(s.id)).slice(0, 6).map(boundedSummary)
    },
  }
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
