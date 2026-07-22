/**
 * Api-step variable plumbing: `${name}` interpolation of values captured from
 * earlier responses, and the dotted-path lookup (`a.b[0].c`) both `capture` and
 * `expect.json` use to address into a parsed JSON body. Deliberately tiny and
 * closed — no expressions, no defaults, no JSONPath operators — so a scenario
 * stays declaratively readable and deterministic.
 */

import type { GuardApiExpect, GuardHttpRequest, GuardJsonMatcher, GuardStreamMatcher } from '@truecourse/shared'

/** Thrown when a template references a variable no earlier step captured. */
export class UnknownVariableError extends Error {
  constructor(readonly variable: string) {
    super(`\${${variable}} is not defined — no earlier step captured it`)
    this.name = 'UnknownVariableError'
  }
}

/** Replace every `${name}` with its captured value; unknown names throw. */
export function interpolate(template: string, vars: ReadonlyMap<string, string>): string {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = vars.get(name)
    if (value === undefined) throw new UnknownVariableError(name)
    return value
  })
}

/** Shared empty credential set — headers with no `{{cred:…}}` resolve unchanged. */
const NO_CREDENTIALS: ReadonlyMap<string, string> = new Map()
/** Shared empty fixture set — requests with no `{{fixture:…}}` resolve unchanged. */
const NO_FIXTURES: ReadonlyMap<string, Record<string, string>> = new Map()

/**
 * Interpolate a request's path, header values, and string bodies in one pass.
 * `{{cred:<name>}}` placeholders resolve against `credentials` in HEADER values ONLY
 * (a secret has one legitimate destination — the header the recipe declares — and is
 * never widened to the path or body). `{{fixture:<name>.<field>}}` placeholders resolve
 * against `fixtures` EVERYWHERE — path, query string, header values, and body — because
 * fixtures are seeded ids/handles, not secrets. Both kinds are injection-safe: only
 * placeholders written in the TEMPLATE are substituted, never one a captured `${var}`
 * expanded to (see {@link resolveHeaderValue} / {@link resolvePlaceholders}).
 */
export function interpolateRequest(
  request: GuardHttpRequest,
  vars: ReadonlyMap<string, string>,
  credentials: ReadonlyMap<string, string> = NO_CREDENTIALS,
  fixtures: ReadonlyMap<string, Record<string, string>> = NO_FIXTURES,
): GuardHttpRequest {
  return {
    ...request,
    path: resolvePlaceholders(request.path, vars, { fixtures }),
    ...(request.headers
      ? {
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([k, v]) => [k, resolveHeaderValue(v, vars, credentials, fixtures)]),
          ),
        }
      : {}),
    ...(request.body !== undefined ? { body: resolvePlaceholders(request.body, vars, { fixtures }) } : {}),
    ...(request.json !== undefined ? { json: interpolateJson(request.json, vars, fixtures) } : {}),
  }
}

/**
 * Interpolate an api EXPECTATION's matcher VALUES with the same substitution surface
 * as a request MINUS credentials: `${var}`/`${unique}` captures and `{{fixture:…}}`
 * (ids/handles), but NEVER `{{cred:…}}` — a secret has no place in an assertion, so a
 * `{{cred:…}}` written in an expectation stays LITERAL (and therefore mismatches
 * loudly rather than silently comparing a secret). Applied before the expectation is
 * evaluated, so the failure/evidence shows the RESOLVED expected value (`team-a1b2c3`,
 * not the template). An unknown `${var}`/`{{fixture:…}}` throws exactly as in a
 * request, so the caller maps it to a fail/error identically.
 */
export function interpolateApiExpect(
  expect: GuardApiExpect,
  vars: ReadonlyMap<string, string>,
  fixtures: ReadonlyMap<string, Record<string, string>> = NO_FIXTURES,
): GuardApiExpect {
  const one = (s: string): string => resolvePlaceholders(s, vars, { fixtures })
  const stream = (m: GuardStreamMatcher): GuardStreamMatcher => ({
    ...(m.equals !== undefined ? { equals: one(m.equals) } : {}),
    ...(m.contains !== undefined ? { contains: one(m.contains) } : {}),
    ...(m.matches !== undefined ? { matches: one(m.matches) } : {}),
  })
  const json = (m: GuardJsonMatcher): GuardJsonMatcher => ({
    ...m,
    // `equals` is a JSON value — interpolate its string leaves (a created id may be
    // nested), mirroring how a request `json` body resolves.
    ...(m.equals !== undefined ? { equals: interpolateJson(m.equals, vars, fixtures) } : {}),
    ...(m.contains !== undefined ? { contains: one(m.contains) } : {}),
    ...(m.matches !== undefined ? { matches: one(m.matches) } : {}),
  })
  return {
    ...expect,
    ...(expect.headers ? { headers: mapValues(expect.headers, stream) } : {}),
    ...(expect.body ? { body: stream(expect.body) } : {}),
    ...(expect.json ? { json: mapValues(expect.json, json) } : {}),
  }
}

/** Map a `{ key → value }` record through `fn`, preserving keys. */
function mapValues<V>(record: Record<string, V>, fn: (v: V) => V): Record<string, V> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fn(v)]))
}

/** Interpolate every string leaf of a JSON body (keys are left untouched). Fixture
 *  placeholders resolve in leaves too — a request body carries seeded ids/handles. */
function interpolateJson(
  value: unknown,
  vars: ReadonlyMap<string, string>,
  fixtures: ReadonlyMap<string, Record<string, string>>,
): unknown {
  if (typeof value === 'string') return resolvePlaceholders(value, vars, { fixtures })
  if (Array.isArray(value)) return value.map((v) => interpolateJson(v, vars, fixtures))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateJson(v, vars, fixtures)]),
    )
  }
  return value
}

/** Thrown when a scenario references a `{{cred:name}}` the recipe never declared. */
export class UnknownCredentialError extends Error {
  constructor(readonly credential: string) {
    super(`{{cred:${credential}}} references a credential the recipe does not declare`)
    this.name = 'UnknownCredentialError'
  }
}

/** Thrown when a `{{fixture:name.field}}` names a fixture/field the seed never emitted. */
export class UnknownFixtureError extends Error {
  constructor(
    readonly fixture: string,
    detail: string,
  ) {
    super(`{{fixture:${fixture}}} ${detail}`)
    this.name = 'UnknownFixtureError'
  }
}

/**
 * The placeholder kinds `resolvePlaceholders` may substitute in a given position:
 * `credentials` are HEADER-only (a secret has one destination); `fixtures` are
 * usable everywhere (they are not secrets). A map left undefined means that kind is
 * NOT active here, so a `{{cred:…}}`/`{{fixture:…}}` token stays literal text.
 */
interface PlaceholderMaps {
  credentials?: ReadonlyMap<string, string>
  fixtures?: ReadonlyMap<string, Record<string, string>>
}

/**
 * Resolve `{{cred:…}}` / `{{fixture:…}}` placeholders written in the TEMPLATE and
 * `${var}` interpolate the literal text between them. Only the placeholder KINDS
 * whose map is supplied are active — others stay literal (a `{{cred:…}}` in a path
 * is left untouched because credentials pass no map there). Placeholders are located
 * in the raw template FIRST and `${var}` interpolation runs only on the surrounding
 * literal segments, so a captured value that itself contains `{{cred:…}}`/`{{fixture:…}}`
 * lands on the wire as literal text — it can never be expanded (the bounded injection
 * path). Resolved values are inserted verbatim and never re-interpolated.
 */
function resolvePlaceholders(
  template: string,
  vars: ReadonlyMap<string, string>,
  maps: PlaceholderMaps,
): string {
  const kinds: string[] = []
  if (maps.credentials) kinds.push('cred')
  if (maps.fixtures) kinds.push('fixture')
  if (kinds.length === 0) return interpolate(template, vars)

  const pattern = new RegExp(`\\{\\{(${kinds.join('|')}):([^{}]+)\\}\\}`, 'g')
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) {
    out += interpolate(template.slice(last, match.index), vars)
    const [, kind, ident] = match
    if (kind === 'cred') {
      const secret = maps.credentials!.get(ident)
      if (secret === undefined) throw new UnknownCredentialError(ident)
      out += secret
    } else {
      out += resolveFixture(ident, maps.fixtures!)
    }
    last = match.index + match[0].length
  }
  return out + interpolate(template.slice(last), vars)
}

/** Resolve one `<name>.<field>` fixture reference to its (already stringified) value. */
function resolveFixture(ident: string, fixtures: ReadonlyMap<string, Record<string, string>>): string {
  const dot = ident.indexOf('.')
  if (dot < 0) {
    throw new UnknownFixtureError(ident, 'must name a field: {{fixture:<name>.<field>}}')
  }
  const name = ident.slice(0, dot)
  const field = ident.slice(dot + 1)
  const record = fixtures.get(name)
  if (record === undefined) throw new UnknownFixtureError(ident, `references a fixture the seed does not provide`)
  if (!(field in record)) {
    throw new UnknownFixtureError(ident, `references field "${field}" the seed did not emit for fixture "${name}"`)
  }
  return record[field]
}

/**
 * Resolve ONE header value: `{{cred:<name>}}` secrets and `{{fixture:<name>.<field>}}`
 * values written in the TEMPLATE, with `${var}` interpolation of the literal text
 * between them (see {@link resolvePlaceholders}). An undeclared credential is a
 * scenario-level {@link UnknownCredentialError}; an undeclared fixture an
 * {@link UnknownFixtureError} — both surfaced as a run error, never a silent pass.
 */
export function resolveHeaderValue(
  template: string,
  vars: ReadonlyMap<string, string>,
  credentials: ReadonlyMap<string, string>,
  fixtures: ReadonlyMap<string, Record<string, string>> = NO_FIXTURES,
): string {
  return resolvePlaceholders(template, vars, { credentials, fixtures })
}

/** A path lookup miss — distinguishes "resolved to undefined" from a bad path. */
export const JSON_PATH_MISS: unique symbol = Symbol('json-path-miss')

/**
 * Resolve a dotted path (`a.b[0].c`; `""` addresses the root) into a parsed JSON
 * value. Returns {@link JSON_PATH_MISS} when any segment is absent.
 */
export function lookupJsonPath(root: unknown, path: string): unknown {
  if (path === '') return root
  const segments: (string | number)[] = []
  // `a.b[0].c` → ['a', 'b', 0, 'c']; bare `[0]` addresses into a root array.
  for (const part of path.split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part)
    if (!m) return JSON_PATH_MISS
    if (m[1] !== '') segments.push(m[1])
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) segments.push(Number(idx[1]))
    if (m[1] === '' && m[2] === '') return JSON_PATH_MISS
  }
  let current: unknown = root
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current) || seg >= current.length) return JSON_PATH_MISS
      current = current[seg]
    } else {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return JSON_PATH_MISS
      if (!(seg in (current as Record<string, unknown>))) return JSON_PATH_MISS
      current = (current as Record<string, unknown>)[seg]
    }
  }
  return current
}

/** The `${name}` string form of a captured JSON value (scalars plain, rest JSON). */
export function captureValueToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
