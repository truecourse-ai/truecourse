/**
 * Api-step variable plumbing: `${name}` interpolation of values captured from
 * earlier responses, and the dotted-path lookup (`a.b[0].c`) both `capture` and
 * `expect.json` use to address into a parsed JSON body. Deliberately tiny and
 * closed — no expressions, no defaults, no JSONPath operators — so a scenario
 * stays declaratively readable and deterministic.
 */

import type {
  GuardApiExpect,
  GuardComparison,
  GuardHttpRequest,
  GuardJsonMatcher,
  GuardStreamMatcher,
} from '@truecourse/shared'
import { mapComparisonStrings } from '../sandbox-token.js'

/** Thrown when a template references a variable no earlier step captured. */
export class UnknownVariableError extends Error {
  constructor(
    readonly variable: string,
    /** The reference AS WRITTEN, so the message quotes the spelling the author used. */
    token: string = `\${${variable}}`,
  ) {
    super(`${token} is not defined — no earlier step captured it`)
    this.name = 'UnknownVariableError'
  }
}

/**
 * A captured-value reference in either spelling: `${captured:<name>}` — the
 * canonical token, the one both drivers share — or the bare `${<name>}` the api
 * driver has always used. ONE namespace, two ways to write it: an api scenario
 * predating the token keeps working, and a scenario written today reads the same
 * on either surface.
 */
const VAR_REFERENCE = /\$\{(?:captured:)?([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Replace every captured-value reference with its value; unknown names throw. */
export function interpolate(template: string, vars: ReadonlyMap<string, string>): string {
  return template.replace(VAR_REFERENCE, (token, name: string) => {
    const value = vars.get(name)
    if (value === undefined) throw new UnknownVariableError(name, token)
    return value
  })
}

/** Shared empty credential set — headers with no `{{cred:…}}` resolve unchanged. */
const NO_CREDENTIALS: ReadonlyMap<string, string> = new Map()
/**
 * Shared empty fixture set — requests with no `{{fixture:…}}` resolve unchanged.
 * Fixture values are the manifest's NATIVE JSON types (a number stays a number); the
 * decimal-string form is derived on demand by {@link resolveFixture} when a fixture is
 * spliced into a longer string, and used verbatim when it is a whole value.
 */
const NO_FIXTURES: ReadonlyMap<string, Record<string, unknown>> = new Map()
/** Shared empty native-capture set — no `${var}` captured a non-string value. */
const NO_NATIVE_VARS: ReadonlyMap<string, unknown> = new Map()

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
  fixtures: ReadonlyMap<string, Record<string, unknown>> = NO_FIXTURES,
  nativeVars: ReadonlyMap<string, unknown> = NO_NATIVE_VARS,
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
    // JSON body leaves can substitute NATIVE values: a `{{fixture:…}}`/`${var}` that is
    // the WHOLE leaf lands as the fixture/capture's JSON type (a number stays a number,
    // so server validation that requires an integer sees one). Path/headers/raw body stay
    // string surfaces (a url or header IS text), so they never take the native path.
    ...(request.json !== undefined ? { json: interpolateJson(request.json, vars, fixtures, nativeVars) } : {}),
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
  fixtures: ReadonlyMap<string, Record<string, unknown>> = NO_FIXTURES,
  nativeVars: ReadonlyMap<string, unknown> = NO_NATIVE_VARS,
): GuardApiExpect {
  const one = (s: string): string => resolvePlaceholders(s, vars, { fixtures })
  // A comparison's operands are the captured-value half of an assertion: resolved
  // here so the comparison compares numbers and the failure quotes them.
  const comparison = (c: GuardComparison): GuardComparison => mapComparisonStrings(c, one)
  const stream = (m: GuardStreamMatcher): GuardStreamMatcher => ({
    ...(m.equals !== undefined ? { equals: one(m.equals) } : {}),
    ...(m.contains !== undefined ? { contains: one(m.contains) } : {}),
    ...(m.matches !== undefined ? { matches: one(m.matches) } : {}),
    ...(m.compare !== undefined ? { compare: comparison(m.compare) } : {}),
  })
  const json = (m: GuardJsonMatcher): GuardJsonMatcher => ({
    ...m,
    ...(m.compare !== undefined ? { compare: comparison(m.compare) } : {}),
    // `equals` is a JSON value — interpolate its string leaves (a created id may be
    // nested), mirroring how a request `json` body resolves. A WHOLE-leaf placeholder
    // takes the native fixture/capture type, so `equals: "{{fixture:evt.id}}"` compares
    // as the JSON number 3 (the type-strict `equals` matcher no longer rejects `3 ≠ "3"`).
    ...(m.equals !== undefined ? { equals: interpolateJson(m.equals, vars, fixtures, nativeVars) } : {}),
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

/**
 * Interpolate every string leaf of a JSON body (keys are left untouched). Fixture
 * placeholders resolve in leaves too — a request body carries seeded ids/handles.
 *
 * NATIVE-WHEN-WHOLE-VALUE: when a leaf is EXACTLY one `{{fixture:<name>.<field>}}` or
 * `${var}` (no surrounding text), it substitutes the NATIVE value — the manifest's
 * JSON type for a fixture, the captured JSON type for a `${var}` — so a number stays a
 * number and a boolean a boolean. A placeholder embedded in a longer string (or several
 * placeholders concatenated) resolves through the string path and stays a string.
 */
function interpolateJson(
  value: unknown,
  vars: ReadonlyMap<string, string>,
  fixtures: ReadonlyMap<string, Record<string, unknown>>,
  nativeVars: ReadonlyMap<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const whole = wholeValuePlaceholder(value)
    if (whole?.kind === 'fixture') {
      const native = nativeFixture(whole.ident, fixtures)
      if (native !== NOT_NATIVE) return native
    } else if (whole?.kind === 'var' && nativeVars.has(whole.name)) {
      return nativeVars.get(whole.name)
    }
    // Not a whole-value placeholder, or its native value is unavailable (e.g. `${unique}`
    // is string-only): fall through to string interpolation — which also raises the right
    // Unknown{Variable,Fixture}Error when the reference is genuinely undefined.
    return resolvePlaceholders(value, vars, { fixtures })
  }
  if (Array.isArray(value)) return value.map((v) => interpolateJson(v, vars, fixtures, nativeVars))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateJson(v, vars, fixtures, nativeVars)]),
    )
  }
  return value
}

/** Sentinel: a whole `{{fixture:…}}` whose fixture/field the seed did not provide. */
const NOT_NATIVE: unique symbol = Symbol('fixture-not-native')

/**
 * The native value of a `<name>.<field>` fixture reference, or {@link NOT_NATIVE} when
 * the fixture or field is absent — the caller then delegates to the string path, which
 * raises the descriptive {@link UnknownFixtureError} (a whole-value leaf never silently
 * swallows a bad reference).
 */
function nativeFixture(ident: string, fixtures: ReadonlyMap<string, Record<string, unknown>>): unknown {
  const dot = ident.indexOf('.')
  if (dot < 0) return NOT_NATIVE
  const record = fixtures.get(ident.slice(0, dot))
  const field = ident.slice(dot + 1)
  if (record === undefined || !(field in record)) return NOT_NATIVE
  return record[field]
}

/** Exact whole-string forms of the two native-capable placeholder kinds (no surrounding text). */
const WHOLE_FIXTURE = /^\{\{fixture:([^{}]+)\}\}$/
/** Both spellings, so `${captured:id}` keeps a captured number a number too. */
const WHOLE_VAR = /^\$\{(?:captured:)?([A-Za-z_][A-Za-z0-9_]*)\}$/

/** Classify a string that is EXACTLY one native-capable placeholder, else null. */
function wholeValuePlaceholder(s: string): { kind: 'fixture'; ident: string } | { kind: 'var'; name: string } | null {
  const f = WHOLE_FIXTURE.exec(s)
  if (f) return { kind: 'fixture', ident: f[1] }
  const v = WHOLE_VAR.exec(s)
  if (v) return { kind: 'var', name: v[1] }
  return null
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
  fixtures?: ReadonlyMap<string, Record<string, unknown>>
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

/**
 * Resolve one `<name>.<field>` fixture reference to its STRING form (the manifest's
 * native value stringified — numbers become their decimal string). This is the mixed-
 * string path: a fixture spliced into a longer template is always text. The whole-value
 * native path lives in {@link nativeFixture}.
 */
function resolveFixture(ident: string, fixtures: ReadonlyMap<string, Record<string, unknown>>): string {
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
  return captureValueToString(record[field])
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
  fixtures: ReadonlyMap<string, Record<string, unknown>> = NO_FIXTURES,
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
