/**
 * SEED EVIDENCE — what the seed step can establish DETERMINISTICALLY about the
 * world the tests need, before any session reasons about it.
 *
 * Two facts, both read off inputs the setup already holds:
 *
 *  1. DOES THE API SURFACE AUTHENTICATE? The seed briefing used to arm the api
 *     principal requirement on one signal only — an OpenAPI security scheme —
 *     so a repository whose API docs are markdown (documenso) never required
 *     one, and whether the seed minted a token was left to the session's mood
 *     (2026-09-03: a fresh seed minted none; 108 api milestones then blocked
 *     on "credentials"). The evidence is wider than one doc format: a declared
 *     scheme, an auth header on a mapped operation, a token-shaped table in
 *     the schema, or corpus docs describing a bearer/api-key header. Any of
 *     them makes `api` a runnable surface the seed must mint a probed
 *     principal for.
 *
 *  2. WHICH RESOURCES DO THE ROUTES REFERENCE? Every `{envelopeId}` in a path
 *     template and every `…Id` field in a request body names a row a test must
 *     already have, and the seed can be told so instead of guessing which
 *     tables matter (documenso 2026-09-03: 259 milestones blocked on
 *     missing-data while the seed had minted one user and nothing else).
 */

import type { Interface } from '@truecourse/shared'
import type { ProbeCandidate } from './openapi-security.js'
import type { SeedDraftDatabase } from './seed-draft.js'

/** One reason the api surface is judged to authenticate. */
export interface ApiAuthEvidence {
  kind: 'scheme' | 'header' | 'token-table' | 'doc'
  /** The fact, in the words the briefing and a refusal state. */
  detail: string
}

/** Request-header names that carry a credential, wherever they appear. */
const AUTH_HEADER = /^(authorization|x-api-key|api-key|x-auth-token|x-access-token|x-token)$/i

/** Table names that hold minted API credentials. */
const TOKEN_TABLE = /(api|access|auth|personal|bearer)[-_ ]?(token|key)s?$|^(api|access|auth)[-_ ]?keys?$|^tokens?$/i

/** Doc text that describes an API credential header. */
const AUTH_DOC = /authorization:\s*bearer|bearer\s+(token|<)|x-api-key|api[ -]?keys?\b|api[ -]?tokens?\b|personal access token/i

/** The api operations of a catalog — every non-RPC interface rooted at a method + path. */
function apiOperations(interfaces: readonly Interface[]): { iface: Interface; method: string; path: string }[] {
  const out: { iface: Interface; method: string; path: string }[] = []
  for (const iface of interfaces) {
    if (iface.type !== 'api' || iface.procedure) continue
    const entry = iface.entry as { method?: string; path?: string }
    if (typeof entry.method === 'string' && typeof entry.path === 'string') {
      out.push({ iface, method: entry.method.toUpperCase(), path: entry.path })
    }
  }
  return out
}

/** The request region of an api interface's contract, whichever it carries. */
function operationRequest(iface: Interface): {
  headers?: readonly { name: string }[]
  body?: readonly { name: string }[]
  query?: readonly { name: string }[]
} {
  const contract = iface.contract as { operation?: { request?: unknown } } | undefined
  const request = contract?.operation?.request
  return request && typeof request === 'object' ? (request as ReturnType<typeof operationRequest>) : {}
}

/**
 * Every reason the api surface authenticates, deduplicated by kind. Empty when
 * nothing says so — a genuinely open API stays seedable with fixtures alone.
 */
export function apiAuthEvidence(args: {
  interfaces: readonly Interface[]
  database: SeedDraftDatabase | null
  /** Corpus docs as text — the same excerpts the briefing carries, or fuller. */
  docs: readonly { doc: string; text: string }[]
  securitySchemes: readonly { name: string }[]
}): ApiAuthEvidence[] {
  const out: ApiAuthEvidence[] = []
  if (args.securitySchemes.length > 0) {
    out.push({
      kind: 'scheme',
      detail: `the corpus declares ${args.securitySchemes.length} security scheme(s): ${args.securitySchemes.map((s) => s.name).join(', ')}`,
    })
  }
  const headerOps = apiOperations(args.interfaces).filter((op) =>
    (operationRequest(op.iface).headers ?? []).some((h) => AUTH_HEADER.test(h.name)),
  )
  if (headerOps.length > 0) {
    const names = [
      ...new Set(
        headerOps.flatMap((op) =>
          (operationRequest(op.iface).headers ?? []).filter((h) => AUTH_HEADER.test(h.name)).map((h) => h.name),
        ),
      ),
    ].sort()
    out.push({
      kind: 'header',
      detail: `${headerOps.length} mapped operation(s) read a credential header (${names.join(', ')}), e.g. ${headerOps[0].method} ${headerOps[0].path}`,
    })
  }
  const tokenTables = (args.database?.tables ?? []).filter((t) => TOKEN_TABLE.test(t.name)).map((t) => t.name)
  if (tokenTables.length > 0) {
    out.push({ kind: 'token-table', detail: `the schema holds API credential table(s): ${tokenTables.join(', ')}` })
  }
  const authDocs = args.docs.filter((d) => AUTH_DOC.test(d.text)).map((d) => d.doc)
  if (authDocs.length > 0) {
    out.push({
      kind: 'doc',
      detail: `${authDocs.length} corpus doc(s) describe an API token/bearer header, e.g. ${authDocs[0]}`,
    })
  }
  return out
}

/** How many interface-derived candidate probes the briefing carries. */
const MAX_INTERFACE_PROBES = 12

/**
 * Probe candidates read off the mapped api operations, for a corpus that
 * declares no OpenAPI security: the cheapest endpoints to confirm against —
 * parameter-free GETs first (no fixture id, no body). They name no scheme; the
 * session confirms one refuses an anonymous call, which is what a probe proves.
 */
export function probeCandidatesFromInterfaces(interfaces: readonly Interface[], max = MAX_INTERFACE_PROBES): ProbeCandidate[] {
  const byRequest = new Map<string, ProbeCandidate>()
  for (const op of apiOperations(interfaces)) {
    const key = `${op.method} ${op.path}`
    if (!byRequest.has(key)) byRequest.set(key, { method: op.method, path: op.path, schemes: [] })
  }
  const rank = (c: ProbeCandidate): number => (c.method === 'GET' ? 0 : 2) + (c.path.includes('{') ? 1 : 0)
  return [...byRequest.values()]
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .slice(0, max)
}

/** One resource the route surface references by id or handle. */
export interface RequiredResource {
  /** The resource's name, singular, as the routes spell it (`envelope`, `team`). */
  resource: string
  /** How many operations reference it. */
  references: number
  /** The parameter/field names that carry it (`envelopeId`, `orgUrl`). */
  params: string[]
  /** One operation that references it, for the briefing. */
  example: string
}

/** How many resources the briefing lists. */
const MAX_REQUIRED_RESOURCES = 12

/** `{id}` under `/documents/{id}` → `document`; `envelopeId` → `envelope`; `orgUrl` → `org`. */
function resourceOf(param: string, precedingSegment: string | undefined): string | null {
  const bare = param.replace(/\?$/, '')
  const suffixed = /^(.+?)(Id|Ids|Url|Slug|Uuid|Key|Token|Handle)$/.exec(bare)
  if (suffixed) return kebab(suffixed[1])
  if (/^(id|ids|uuid|slug|url|handle)$/i.test(bare)) {
    if (!precedingSegment || precedingSegment.startsWith('{')) return null
    return kebab(singular(precedingSegment))
  }
  return null
}

function singular(segment: string): string {
  if (/ies$/.test(segment)) return segment.replace(/ies$/, 'y')
  if (/(ses|xes|zes|ches|shes)$/.test(segment)) return segment.replace(/es$/, '')
  if (/s$/.test(segment) && !/ss$/.test(segment)) return segment.replace(/s$/, '')
  return segment
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

/** Parameters an operation references that are not resources — versions, paging, formats. */
const NOT_A_RESOURCE = /^(version|page|limit|offset|cursor|format|locale|lang|type|kind|status|sort|order)$/i

/**
 * The resources the route surface references, most-referenced first: path
 * template parameters and request fields that carry an id or a handle, folded
 * to the resource they name. Empty for a surface with no such references.
 */
export function requiredResources(interfaces: readonly Interface[], max = MAX_REQUIRED_RESOURCES): RequiredResource[] {
  const byResource = new Map<string, { references: number; params: Set<string>; example: string }>()
  const note = (resource: string, param: string, example: string): void => {
    const row = byResource.get(resource) ?? { references: 0, params: new Set<string>(), example }
    row.references += 1
    row.params.add(param.replace(/\?$/, ''))
    byResource.set(resource, row)
  }
  for (const op of apiOperations(interfaces)) {
    const label = `${op.method} ${op.path}`
    const segments = op.path.split('/').filter(Boolean)
    const seen = new Set<string>()
    segments.forEach((segment, i) => {
      const param = /^\{([^}]+)\}$/.exec(segment)?.[1]
      if (!param || NOT_A_RESOURCE.test(param)) return
      const resource = resourceOf(param, segments[i - 1])
      if (resource && !seen.has(resource)) {
        seen.add(resource)
        note(resource, param, label)
      }
    })
    const request = operationRequest(op.iface)
    for (const field of [...(request.body ?? []), ...(request.query ?? [])]) {
      if (NOT_A_RESOURCE.test(field.name)) continue
      const resource = /^(.+?)(Id|Ids|Url|Slug|Uuid|Handle)$/.exec(field.name) ? resourceOf(field.name, undefined) : null
      if (resource && !seen.has(resource)) {
        seen.add(resource)
        note(resource, field.name, label)
      }
    }
  }
  return [...byResource]
    .map(([resource, row]) => ({
      resource,
      references: row.references,
      params: [...row.params].sort(),
      example: row.example,
    }))
    .sort((a, b) => b.references - a.references || a.resource.localeCompare(b.resource))
    .slice(0, max)
}
