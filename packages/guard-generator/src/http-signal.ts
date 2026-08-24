/**
 * THE HTTP TRANSPORT GATE — the deterministic answer to "may this flow be realized
 * on the api surface at all?", asked before the (paid) match call and before any
 * per-surface gap is recorded.
 *
 * A request/response protocol is not an HTTP API. A JSON-over-stdin/stdout worker,
 * a socket protocol, a pipe — all speak "requests" and "responses", and that
 * vocabulary alone used to be enough for a flow to be paired with the api surface,
 * where it could only ever report "blocked on a recipe `api` block": an ask no
 * recipe edit can satisfy, because there is no HTTP server to declare. So the api
 * surface requires a TRANSPORT signal, never protocol-shaped prose:
 *
 *  - the flow's spec names an HTTP concrete — an OpenAPI operation section, a
 *    `GET /v2/bookings` in prose, a `curl` invocation, a status code, a header, or
 *    the protocol itself (`HTTP`, `REST`, a loopback URL); or
 *  - the flow's spec names a path this repo actually serves — the route half of the
 *    api journey catalog (route registrations ∪ OpenAPI operations), joined here on
 *    the route's static prefix.
 *
 * Every check is a literal read of text the user wrote: no LLM, no inference, and
 * no evidence means no api surface. The bias runs the other way (a false signal
 * only means the matcher decides, exactly as before) because a wrong block deletes
 * coverage silently, while a wrong pairing is answered by an `unrealizable` verdict.
 */

import type { GuardFlow, Journey } from '@truecourse/shared'
import { documentedApiPaths, documentedPathsInText } from './server-binding.js'
import type { SectionInput } from './section-plan.js'

/** How a flow earned the api surface — the evidence, in the words it was found in. */
export interface HttpSignal {
  kind: 'documented-path' | 'status-code' | 'header' | 'protocol' | 'served-route'
  /** The literal text that carried the signal, for the reason line and for tests. */
  evidence: string
}

export interface HttpSignalInput {
  flow: Pick<GuardFlow, 'title' | 'goal' | 'milestones'>
  /** The flow's bound sections — their prose is spec the user wrote. */
  sections: readonly SectionInput[]
  /** OpenAPI doc → its `servers` base path, as the work plan derived it. */
  basePaths: ReadonlyMap<string, string>
  /** The repo's api journeys — route registrations ∪ OpenAPI operations. */
  apiJourneys: readonly Journey[]
}

/**
 * The flow's HTTP transport evidence, or `null` when it names none. `null` is the
 * whole gate: the api surface is not a candidate for that flow — no match call, no
 * per-surface gap, no manifest entry.
 */
export function flowHttpSignal(input: HttpSignalInput): HttpSignal | null {
  const documented = documentedApiPaths(input.sections, input.basePaths)
  if (documented.length > 0) return { kind: 'documented-path', evidence: documented[0] }

  const claimTexts = flowClaimTexts(input.flow)
  for (const text of claimTexts) {
    const paths = documentedPathsInText(text)
    if (paths.length > 0) return { kind: 'documented-path', evidence: paths[0] }
  }

  const texts = [...claimTexts, ...input.sections.map((s) => s.fullText || s.ownText)].filter((t) => t !== '')
  for (const text of texts) {
    const signal = httpConcreteIn(text) ?? servedRouteIn(text, input.apiJourneys)
    if (signal) return signal
  }
  return null
}

/**
 * The gap a flow settles with when the api surface was its ONLY candidate and it
 * carries no HTTP signal — coverage honesty, never an unsatisfiable recipe ask: the
 * flow is unrealizable here until its spec names the transport, and the fix is a
 * doc that says which endpoint serves it (or a driver that speaks its protocol).
 */
export const NO_HTTP_SIGNAL_REASON =
  'the api surface is the only one this repo can be driven through, and this flow names no HTTP transport — no method + path, status code, header, or route this repository serves'

// ---------------------------------------------------------------------------
// The literal readings
// ---------------------------------------------------------------------------

/** Flow-level prose the user wrote: the goal, the title, and every claim. */
function flowClaimTexts(flow: HttpSignalInput['flow']): string[] {
  return [flow.title, flow.goal, ...flow.milestones.flatMap((m) => [m.claimTitle, m.note ?? ''])].filter(
    (t) => t !== '',
  )
}

/** `HTTP/1.1 200`, `404 Not Found`, `responds with 201`, `status code 401`. */
const STATUS_PROTOCOL_RE = /\bHTTP\/\d(?:\.\d)?\s+[1-5]\d{2}\b/
const STATUS_REASON_RE =
  /\b[1-5]\d{2}\s+(?:OK|Created|Accepted|No Content|Not Modified|Moved Permanently|Found|Bad Request|Unauthorized|Payment Required|Forbidden|Not Found|Method Not Allowed|Conflict|Gone|Unsupported Media Type|Unprocessable(?: Entity| Content)?|Too Many Requests|Internal Server Error|Not Implemented|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i
const STATUS_VERB_RE =
  /\b(?:status(?:\s+code)?|responds?\s+with|returns?|answers?(?:\s+with)?|replies\s+with)\s+(?:an?\s+|HTTP\s+)*[1-5]\d{2}\b/i

/** A header named as one: `Authorization: …`, `the Authorization header`. */
const HEADER_NAMES =
  'Authorization|Content-Type|Content-Length|Accept|Accept-Encoding|Cache-Control|Cookie|Set-Cookie|ETag|If-None-Match|Last-Modified|Location|Retry-After|User-Agent|WWW-Authenticate|X-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*'
const HEADER_COLON_RE = new RegExp(`\\b(?:${HEADER_NAMES})\\s*:`)
const HEADER_WORD_RE = new RegExp(
  `\\b(?:${HEADER_NAMES})\\b[^\\n]{0,40}?\\bheaders?\\b|\\bheaders?\\b[^\\n]{0,40}?\\b(?:${HEADER_NAMES})\\b`,
)

/** The transport, named: uppercase `HTTP`/`HTTPS`/`REST`, or a loopback URL. */
const PROTOCOL_RE = /\bHTTPS?\b|\bREST\b/
const LOOPBACK_URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[/\s]/i

/** The first HTTP concrete this text states, if any. */
function httpConcreteIn(text: string): HttpSignal | null {
  for (const re of [STATUS_PROTOCOL_RE, STATUS_REASON_RE, STATUS_VERB_RE]) {
    const m = re.exec(text)
    if (m) return { kind: 'status-code', evidence: m[0].trim() }
  }
  for (const re of [HEADER_COLON_RE, HEADER_WORD_RE]) {
    const m = re.exec(text)
    if (m) return { kind: 'header', evidence: m[0].trim() }
  }
  for (const re of [LOOPBACK_URL_RE, PROTOCOL_RE]) {
    const m = re.exec(text)
    if (m) return { kind: 'protocol', evidence: m[0].trim() }
  }
  return null
}

/**
 * Does this text name a path the repo actually serves? Joined on the route's
 * STATIC prefix (`/todos/{id}` → `/todos`), so prose that names the collection
 * counts and a bare `/` (or a one-character prefix) never does.
 */
function servedRouteIn(text: string, apiJourneys: readonly Journey[]): HttpSignal | null {
  for (const prefix of routePrefixes(apiJourneys)) {
    const at = text.indexOf(prefix)
    if (at === -1) continue
    const next = text[at + prefix.length]
    if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) return { kind: 'served-route', evidence: prefix }
  }
  return null
}

/** Each api journey's static route prefix, longest first, dropping the trivial ones. */
function routePrefixes(apiJourneys: readonly Journey[]): string[] {
  const prefixes = new Set<string>()
  for (const journey of apiJourneys) {
    const entry = journey.entry as { path?: string }
    if (typeof entry.path !== 'string') continue
    const segments: string[] = []
    for (const segment of entry.path.split('/').filter((s) => s !== '')) {
      if (segment.includes('{') || segment.includes(':') || segment.includes('*')) break
      segments.push(segment)
    }
    const prefix = `/${segments.join('/')}`
    if (prefix.length > 2) prefixes.add(prefix)
  }
  return [...prefixes].sort((a, b) => b.length - a.length)
}
