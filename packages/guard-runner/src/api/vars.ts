/**
 * Api-step variable plumbing: `${name}` interpolation of values captured from
 * earlier responses, and the dotted-path lookup (`a.b[0].c`) both `capture` and
 * `expect.json` use to address into a parsed JSON body. Deliberately tiny and
 * closed — no expressions, no defaults, no JSONPath operators — so a scenario
 * stays declaratively readable and deterministic.
 */

import type { GuardHttpRequest } from '@truecourse/shared'

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

/**
 * Interpolate a request's path, header values, and string bodies in one pass. Header
 * values additionally resolve `{{cred:<name>}}` placeholders against `credentials`
 * (see {@link resolveHeaderValue}) — injection-safely: only placeholders written in
 * the header TEMPLATE receive a secret, never one a captured `${var}` expanded to.
 */
export function interpolateRequest(
  request: GuardHttpRequest,
  vars: ReadonlyMap<string, string>,
  credentials: ReadonlyMap<string, string> = NO_CREDENTIALS,
): GuardHttpRequest {
  return {
    ...request,
    path: interpolate(request.path, vars),
    ...(request.headers
      ? {
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([k, v]) => [k, resolveHeaderValue(v, vars, credentials)]),
          ),
        }
      : {}),
    ...(request.body !== undefined ? { body: interpolate(request.body, vars) } : {}),
    ...(request.json !== undefined ? { json: interpolateJson(request.json, vars) } : {}),
  }
}

/** Interpolate every string leaf of a JSON body (keys are left untouched). */
function interpolateJson(value: unknown, vars: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return interpolate(value, vars)
  if (Array.isArray(value)) return value.map((v) => interpolateJson(v, vars))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateJson(v, vars)]),
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

/** `{{cred:<name>}}` — a recipe-declared credential placeholder in a header value. */
const CREDENTIAL_PLACEHOLDER = /\{\{cred:([^{}]+)\}\}/g

/**
 * Resolve ONE header value: replace each `{{cred:<name>}}` placeholder written in
 * the TEMPLATE with its resolved secret, and `${var}` interpolate the literal text
 * between placeholders. Because credential placeholders are located in the raw
 * template FIRST and `${var}` interpolation runs only on the surrounding literal
 * segments, a captured value that itself contains `{{cred:…}}` lands on the wire as
 * literal text — it can never be expanded into a secret (the bounded injection path).
 * Secrets are inserted verbatim and never re-interpolated. An undeclared name is a
 * scenario-level {@link UnknownCredentialError}, surfaced as a run error.
 */
export function resolveHeaderValue(
  template: string,
  vars: ReadonlyMap<string, string>,
  credentials: ReadonlyMap<string, string>,
): string {
  const pattern = new RegExp(CREDENTIAL_PLACEHOLDER.source, 'g')
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) {
    out += interpolate(template.slice(last, match.index), vars)
    const secret = credentials.get(match[1])
    if (secret === undefined) throw new UnknownCredentialError(match[1])
    out += secret
    last = match.index + match[0].length
  }
  return out + interpolate(template.slice(last), vars)
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
