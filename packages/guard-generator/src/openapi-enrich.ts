/**
 * Cross-source OpenAPI enrichment for markdown-derived claims.
 *
 * A markdown claim carries a behavioral rule as prose ("a POST to /v2/bookings with
 * no `start` returns 400") but no structured request body — the body's field shape
 * lives only in the OpenAPI document. This module builds an index of every OpenAPI
 * operation section in the doc universe and, for a given markdown section, matches
 * the endpoints its prose names to those operations, so the authoring prompt can be
 * handed the authoritative request-body JSON schema.
 *
 * The matching is deterministic and deliberately CONSERVATIVE: a method token is
 * required (a bare path never matches), path templates are folded so `/x/{id}`,
 * `/x/:id`, `/x/<id>` and `/x/42` all normalize equal, and an ambiguous reference
 * (one that matches two operations) is skipped rather than guessed. Enrichment is
 * additive: a section that matches nothing is byte-identical to before this module
 * existed (empty {@link matchedSchemaFingerprint}, no prompt block).
 */

import { createHash } from 'node:crypto'
import { HTTP_METHODS, requestBodyJsonSchema } from '@truecourse/shared/openapi'
import type { SectionInput } from './section-plan.js'

/** One OpenAPI operation, keyed by its section anchor, ready to match prose against. */
export interface OperationEntry {
  /** The operation section's binding anchor. */
  anchor: string
  /** Repo-relative doc path the operation came from. */
  doc: string
  /** The operation section's fingerprint — folded into the re-plan gate so a schema
   *  edit re-authors the markdown sections that reference it. */
  fingerprint: string
  /** Uppercase HTTP verb (`POST`). */
  method: string
  /** The raw route template, verbatim (`/v2/bookings/{id}`). */
  path: string
  /**
   * The doc's `servers` base path (`/api/v1`), or `''` when it declares none. A prose
   * reference is matched against BOTH the bare {@link path} and the mounted
   * `basePath + path`, so a markdown doc that writes either form resolves to this op.
   */
  basePath: string
  /** The declared `application/json` request schema — present only for write ops
   *  (POST/PUT/PATCH) that declare a request body. */
  requestSchema?: unknown
}

/** The HTTP verbs a write op uses — the only ones that carry a request body schema. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/** Uppercase verbs the prose scanner recognizes (TRACE excluded — never a doc verb). */
const PROSE_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const ENDPOINT_RE = new RegExp(`\\b(${PROSE_VERBS.join('|')})\\s+(/[^\\s\`"')]*)`, 'gi')

/**
 * Parse a section whose `fullText` is the canonical `{ method, path, operation }`
 * slice into an {@link OperationEntry}, or `null` when it is not an operation
 * section (markdown prose fails `JSON.parse`; JSON of any other shape is rejected).
 */
export function parseOperationSection(section: SectionInput, basePath = ''): OperationEntry | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(section.fullText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const { method, path, operation } = obj
  if (typeof method !== 'string' || typeof path !== 'string') return null
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return null
  if (!HTTP_METHODS.includes(method.toLowerCase())) return null
  const upper = method.toUpperCase()
  const requestSchema = WRITE_METHODS.has(upper) ? requestBodyJsonSchema(operation) : undefined
  return {
    anchor: section.anchor,
    doc: section.doc,
    fingerprint: section.fingerprint,
    method: upper,
    path,
    basePath,
    ...(requestSchema !== undefined ? { requestSchema } : {}),
  }
}

/**
 * Build the operation index across a whole section universe — the OpenAPI operation
 * sections only; markdown sections fall out (they don't parse). `basePaths` supplies
 * each doc's `servers` base path (`doc → /api/v1`) so an operation carries the mounted
 * path form for matching; a doc absent from the map (or an empty base path) behaves
 * exactly as before — bare-path matching only.
 */
export function buildOperationIndex(sections: SectionInput[], basePaths?: Map<string, string>): OperationEntry[] {
  const out: OperationEntry[] = []
  for (const s of sections) {
    const e = parseOperationSection(s, basePaths?.get(s.doc) ?? '')
    if (e) out.push(e)
  }
  return out
}

/** Normalize a route/path into comparable segments, folding param/id segments to `*`. */
function normalizeSegments(path: string): string[] {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      if (
        /^\{.*\}$/.test(seg) || // {id}
        /^:.+$/.test(seg) || //    :id
        /^<.*>$/.test(seg) || //   <id>
        /^\d+$/.test(seg) || //    42
        seg === '*'
      ) {
        return '*'
      }
      return seg
    })
}

function segmentsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i])
}

/**
 * Match the endpoints a markdown section's prose names to operations in `index`.
 * Returns the matched entries (deduped by anchor). A reference is kept only when it
 * matches EXACTLY one operation — a bare path (no method) is ignored, and an
 * ambiguous reference (matching two operations) is skipped.
 */
export function matchOperationsForSection(section: SectionInput, index: OperationEntry[]): OperationEntry[] {
  const byAnchor = new Map<string, OperationEntry>()
  for (const m of section.fullText.matchAll(ENDPOINT_RE)) {
    const method = m[1].toUpperCase()
    // Trailing sentence punctuation glued to the path (`…to /v2/bookings.`) is not
    // part of the route — strip it so the prose reference still matches the operation.
    const rawPath = m[2].replace(/[.,;:]+$/, '')
    const segs = normalizeSegments(rawPath)
    // Match the prose path against BOTH the bare handler path and the mounted
    // (base-pathed) path, so a doc that writes either form resolves to the operation.
    const hits = index.filter(
      (e) =>
        e.method === method &&
        (segmentsEqual(normalizeSegments(e.path), segs) ||
          (e.basePath !== '' && segmentsEqual(normalizeSegments(e.basePath + e.path), segs))),
    )
    if (hits.length === 1) byAnchor.set(hits[0].anchor, hits[0])
    // no match, or ambiguous (>1) → skip
  }
  return [...byAnchor.values()]
}

/**
 * The write-op entries a section matches, as prompt-ready `{ method, path, requestSchema }`
 * records (pretty-printed schema), sorted stably by `method path`. Empty when nothing
 * matches. The `path` is the MOUNTED path (`basePath + path`) for a spec that declares a
 * `servers` base path, so the model authors a request URL that hits the mounted server;
 * a base-path-less op renders its bare path unchanged (follow-up B).
 */
export function matchedRequestSchemas(
  section: SectionInput,
  index: OperationEntry[],
): { method: string; path: string; requestSchema: string }[] {
  return matchOperationsForSection(section, index)
    .filter((e) => e.requestSchema !== undefined)
    .map((e) => ({
      method: e.method,
      path: e.basePath ? e.basePath + e.path : e.path,
      requestSchema: JSON.stringify(e.requestSchema, null, 2),
    }))
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`))
}

/**
 * A content key over the write-op schemas a section matches — `''` when it matches
 * none (byte-identity guarantee: an unmatched section's cache/plan keys are unchanged
 * from before enrichment). Non-empty and content-derived otherwise, so it moves when
 * a referenced operation's schema (hence its section fingerprint) changes.
 */
export function matchedSchemaFingerprint(section: SectionInput, index: OperationEntry[]): string {
  const fingerprints = matchOperationsForSection(section, index)
    .filter((e) => e.requestSchema !== undefined)
    .map((e) => e.fingerprint)
    .sort()
  if (fingerprints.length === 0) return ''
  return 'sha256:' + createHash('sha256').update(fingerprints.join('\0')).digest('hex')
}
