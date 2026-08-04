/**
 * Journey construction for the api surface — the one place an HTTP operation turns
 * into a {@link Journey}, so the route-registration derivation and the OpenAPI
 * derivation produce BYTE-IDENTICAL journeys for the same operation. Identity is
 * the operation (`METHOD /canonical/path`), never which side declared it: a repo
 * that gains an OpenAPI doc for routes the tree already mapped must not move a
 * single id or fingerprint.
 */

import { canonicalRoutePath, journeyFingerprint, type Journey } from '@truecourse/shared'

/** One HTTP operation as either derivation found it. */
export interface ApiJourneySeed {
  /** Uppercase HTTP method, e.g. `GET`. */
  method: string
  /** Canonical path template (`{name}` params — see `canonicalRoutePath`). */
  path: string
  /** Cosmetic one-liner (handler name or OpenAPI operationId) — never fingerprinted. */
  label?: string
  /** Declared in an OpenAPI doc with no matching route registration (drift cross-check). */
  specOnly?: boolean
}

/**
 * Build the api journeys for a set of operations: one journey per operation, a
 * single `request` step, ids slugified from the operation identity. Seeds are
 * emitted in the order given, duplicates (same method + path) collapse onto the
 * first.
 */
export function buildApiJourneys(seeds: readonly ApiJourneySeed[]): Journey[] {
  const journeys: Journey[] = []
  const seenOps = new Set<string>()
  const usedIds = new Set<string>()

  for (const seed of seeds) {
    const method = seed.method.trim().toUpperCase()
    const path = canonicalRoutePath(seed.path)
    if (!method) continue
    const key = `${method} ${path}`
    if (seenOps.has(key)) continue
    seenOps.add(key)

    const id = uniqueId(`api/${slugify(method, path)}`, usedIds)
    const entry = { method, path }
    const steps: Journey['steps'] = [
      {
        kind: 'request' as const,
        method,
        path,
        ...(seed.label ? { label: seed.label } : {}),
      },
    ]
    journeys.push({
      id,
      type: 'api',
      title: key,
      entry,
      steps,
      fingerprint: journeyFingerprint({ type: 'api', entry, steps }),
      ...(seed.specOnly ? { specOnly: true as const } : {}),
    })
  }
  return journeys
}

/** `GET /todos/{id}` → `get-todos-id`; the root path yields `get-root`. */
function slugify(method: string, path: string): string {
  const pathSlug = path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${method.toLowerCase()}${pathSlug ? `-${pathSlug}` : '-root'}`
}

/** Two operations can slugify alike (`/a/b` and `/a-b`); ids stay unique. */
function uniqueId(base: string, used: Set<string>): string {
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  used.add(id)
  return id
}
