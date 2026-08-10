/**
 * Interface construction for the api surface — the one place an HTTP operation turns
 * into a {@link Interface}, so the route-registration derivation and the OpenAPI
 * derivation produce BYTE-IDENTICAL interfaces for the same operation. Identity is
 * the operation (`METHOD /canonical/path`), never which side declared it: a repo
 * that gains an OpenAPI doc for routes the tree already mapped must not move a
 * single id or fingerprint.
 */

import { canonicalRoutePath, interfaceFingerprint, type Interface } from '@truecourse/shared'

/** One HTTP operation as either derivation found it. */
export interface ApiInterfaceSeed {
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
 * Build the api interfaces for a set of operations: one interface per operation, a
 * single `request` step, ids slugified from the operation identity. Seeds are
 * emitted in the order given, duplicates (same method + path) collapse onto the
 * first.
 */
export function buildApiInterfaces(seeds: readonly ApiInterfaceSeed[]): Interface[] {
  const interfaces: Interface[] = []
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
    const group = routeFamily(path)
    const steps: Interface['steps'] = [
      {
        kind: 'request' as const,
        method,
        path,
        ...(seed.label ? { label: seed.label } : {}),
      },
    ]
    interfaces.push({
      id,
      type: 'api',
      title: key,
      ...(group ? { group } : {}),
      entry,
      steps,
      fingerprint: interfaceFingerprint({ type: 'api', entry, steps }),
      ...(seed.specOnly ? { specOnly: true as const } : {}),
    })
  }
  return interfaces
}

/**
 * The ROUTE FAMILY an operation belongs to — its {@link Interface.group}: the
 * resource the path names, so `/api/repos/{id}/analyses`, its `/diff` sibling and
 * `/analyses/{analysisId}/usage` all read as the `analyses` family.
 *
 * The rule is the shape of a REST path and nothing else: the resource a path names
 * is the segment its identifiers hang off, so the family is the FIRST static
 * segment that follows a path parameter. A path with no parameter names its
 * resource directly, and then a leading `api` mount point is stepped over (the one
 * segment every operation of an api-mounted app shares says nothing about which
 * family an operation is in). A path with no static segment at all (`/`) has no
 * family to establish, and none is invented — the omitted-vs-empty rule.
 */
function routeFamily(path: string): string | undefined {
  const segments = path.split('/').filter(Boolean)
  const isParam = (segment: string) => segment.startsWith('{')
  const afterParam = segments.findIndex((segment, i) => i > 0 && isParam(segments[i - 1]!) && !isParam(segment))
  if (afterParam > 0) return segments[afterParam]
  const named = segments.filter((segment) => !isParam(segment))
  const first = named[0]
  if (first === undefined) return undefined
  return first.toLowerCase() === 'api' && named[1] !== undefined ? named[1] : first
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
