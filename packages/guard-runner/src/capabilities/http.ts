/**
 * The `http` setup capability — boot one scripted loopback HTTP stub server per
 * declared stub, so a flow blocked on a third party becomes testable. Each stub
 * answers ONLY what the scenario scripted (it never proxies anywhere), records
 * every request it received, and asserts what the app under test was supposed to
 * send it.
 *
 * Lifecycle (both drivers): the stubs come up BEFORE the sandbox is built and
 * therefore before the app/server boots — the app must be able to reach them from
 * its very first request, and its env has to carry their origins. The scenario
 * points the dependency's base-URL env var at a stub by writing
 * `${HTTP_STUB:<name>}` in a `setup.env` VALUE; {@link applyHttpStubOrigins}
 * substitutes it exactly like `${PORT}` is substituted at server boot. They are
 * stopped when the scenario finishes, pass or fail.
 *
 * Failure semantics — three distinct kinds, deliberately different outcomes:
 *   - a stub that cannot BOOT (or a `${HTTP_STUB:…}` naming an undeclared stub)
 *     is infrastructure: {@link CapabilityError} → the scenario's `error` outcome,
 *     never a silent skip;
 *   - a request matching no route under `unmatched: 'error'` (the default), a
 *     violated `expect`, or a `calls` count mismatch is a FINDING about the
 *     app-vs-third-party contract: the scenario FAILS, with the received request
 *     excerpted. Violations are recorded as they happen and settled at scenario
 *     end ({@link HttpStubsHandle.settle}), so a scenario passes only when its
 *     steps pass AND its stubs saw exactly what was declared.
 *
 * The stub is a fake counterparty, so the mock-vs-materialize rule holds: script
 * responses here, materialize local deterministic state with `setup.files`/`git`.
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GuardHttpStub, GuardHttpStubRoute, GuardSetup } from '@truecourse/shared'
import { CapabilityError } from './index.js'
import { lookupJsonPath, JSON_PATH_MISS } from '../api/vars.js'
import { jsonEquals } from '../api/expect.js'

/** The capability name, as it appears in a {@link CapabilityError} message. */
const CAPABILITY = 'http'

/**
 * Per-field cap on the recorded request text an excerpt carries. Mirrors the
 * runner's `STEP_OUTPUT_LIMIT` convention (kept local so the capability layer
 * does not import the driver that consumes it).
 */
const STUB_EXCERPT_LIMIT = 1200

/** Cap on the requests one stub retains — a runaway client cannot exhaust memory. */
const MAX_RECORDED_REQUESTS = 200

/** The literal placeholder shape a scenario writes where a stub's origin belongs. */
const STUB_PLACEHOLDER_RE = /\$\{HTTP_STUB:([A-Za-z0-9_-]+)\}/g

/** One recorded request, as the stub received it. */
export interface HttpStubRequestRecord {
  method: string
  /** Path incl. query string, as sent. */
  url: string
  /** Lower-cased header names. */
  headers: Record<string, string>
  /** Raw request body (truncated to {@link STUB_EXCERPT_LIMIT}). */
  body: string
  /** Index of the route that served it; `null` when nothing matched. */
  routeIndex: number | null
}

/** A scenario-failing stub finding: an unscripted call, a bad request, a bad count. */
export interface HttpStubViolation {
  stub: string
  kind: 'unmatched' | 'expect' | 'calls'
  /** 1-based step the violation happened during; absent for the end-of-run `calls` check. */
  step?: number
  expected: string
  actual: string
  /** Multi-line evidence (the received request, excerpted). */
  detail: string[]
}

export interface HttpStubsHandle {
  /** stub name → `http://127.0.0.1:<port>`. */
  origins: ReadonlyMap<string, string>
  /** Attribute subsequent violations to this 1-based step. */
  markStep(step: number): void
  /** Every request every stub received, in arrival order (for evidence). */
  records(): ReadonlyMap<string, readonly HttpStubRequestRecord[]>
  /**
   * The FIRST violation the scenario should fail on, or `null` when the stubs saw
   * exactly what was declared. Called at scenario end: request-level violations
   * recorded during the run come first (in arrival order), then the `calls` counts.
   */
  settle(): HttpStubViolation | null
  /** Close every stub server. Idempotent. */
  stop(): Promise<void>
}

interface StubServer {
  name: string
  server: http.Server
  origin: string
}

/**
 * Boot every declared stub. Returns `null` when nothing is declared, so a scenario
 * without the capability pays nothing. A listen failure throws
 * {@link CapabilityError} after closing whatever already came up.
 */
export async function startHttpStubs(
  stubs: GuardSetup['http'] | undefined,
): Promise<HttpStubsHandle | null> {
  const names = stubs ? Object.keys(stubs) : []
  if (!stubs || names.length === 0) return null

  const violations: HttpStubViolation[] = []
  const records = new Map<string, HttpStubRequestRecord[]>()
  const callCounts = new Map<string, number[]>()
  const servers: StubServer[] = []
  const origins = new Map<string, string>()
  let currentStep: number | undefined

  const closeAll = async (): Promise<void> => {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.server.closeAllConnections?.()
            s.server.close(() => resolve())
          }),
      ),
    )
  }

  for (const name of names) {
    const declaration = stubs[name]
    records.set(name, [])
    callCounts.set(name, declaration.routes.map(() => 0))
    const server = http.createServer((req, res) => {
      handleStubRequest({
        name,
        declaration,
        req,
        res,
        records: records.get(name)!,
        counts: callCounts.get(name)!,
        violations,
        step: () => currentStep,
      })
    })
    try {
      await listen(server)
    } catch (e) {
      servers.push({ name, server, origin: '' })
      await closeAll()
      throw new CapabilityError(
        CAPABILITY,
        `stub "${name}" could not start: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${address.port}`
    servers.push({ name, server, origin })
    origins.set(name, origin)
  }

  return {
    origins,
    markStep(step) {
      currentStep = step
    },
    records: () => records,
    settle() {
      if (violations.length > 0) return violations[0]
      for (const [name, counts] of callCounts) {
        const routes = stubs[name].routes
        for (const [i, route] of routes.entries()) {
          if (route.calls === undefined || route.calls === counts[i]) continue
          return {
            stub: name,
            kind: 'calls',
            expected: `stub "${name}" route ${route.method} ${route.path} to be called ${route.calls} time(s)`,
            actual: `it was called ${counts[i]} time(s)`,
            detail: [
              `stub "${name}" route ${route.method} ${route.path}`,
              `expected calls: ${route.calls}`,
              `actual calls:   ${counts[i]}`,
              ...describeRecords(records.get(name) ?? []),
            ],
          }
        }
      }
      return null
    },
    stop: closeAll,
  }
}

/** Bind one stub server to an ephemeral loopback port. */
function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

interface HandleParams {
  name: string
  declaration: GuardHttpStub
  req: http.IncomingMessage
  res: http.ServerResponse
  records: HttpStubRequestRecord[]
  counts: number[]
  violations: HttpStubViolation[]
  step: () => number | undefined
}

/** Match, record, assert, respond — the whole of one stub request. */
function handleStubRequest(p: HandleParams): void {
  let body = ''
  p.req.on('data', (chunk: Buffer) => {
    if (body.length < STUB_EXCERPT_LIMIT * 4) body += chunk.toString('utf-8')
  })
  p.req.on('end', () => {
    const method = (p.req.method ?? 'GET').toUpperCase()
    const rawUrl = p.req.url ?? '/'
    const url = new URL(rawUrl, 'http://stub.invalid')
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(p.req.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v
      else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ')
    }

    const routeIndex = p.declaration.routes.findIndex(
      (route) => route.method === method && pathMatches(route.path, url.pathname),
    )
    if (p.records.length < MAX_RECORDED_REQUESTS) {
      p.records.push({
        method,
        url: rawUrl,
        headers,
        body: body.slice(0, STUB_EXCERPT_LIMIT),
        routeIndex: routeIndex === -1 ? null : routeIndex,
      })
    }

    if (routeIndex === -1) {
      // Nothing scripted for this call. Under the default `error` policy that is a
      // finding (the app talks to the third party in a way the scenario never
      // declared); under `404` it is tolerated. The stub answers 404 either way —
      // it has nothing truthful to say.
      if ((p.declaration.unmatched ?? 'error') === 'error') {
        p.violations.push({
          stub: p.name,
          kind: 'unmatched',
          ...(p.step() !== undefined ? { step: p.step()! } : {}),
          expected: `stub "${p.name}" to receive only its scripted routes (${p.declaration.routes
            .map((r) => `${r.method} ${r.path}`)
            .join(', ')})`,
          actual: `it received ${method} ${rawUrl}`,
          detail: [
            `stub "${p.name}" received an unscripted request`,
            `--- request ---`,
            ...describeRequest(method, rawUrl, headers, body),
          ],
        })
      }
      respond(p.res, 404, { 'content-type': 'application/json' }, JSON.stringify({ error: 'no stub route matched' }))
      return
    }

    const route = p.declaration.routes[routeIndex]
    p.counts[routeIndex] += 1

    const failure = route.expect
      ? evaluateStubExpect(route.expect, { method, url, headers, body })
      : null
    if (failure) {
      p.violations.push({
        stub: p.name,
        kind: 'expect',
        ...(p.step() !== undefined ? { step: p.step()! } : {}),
        expected: `stub "${p.name}" route ${route.method} ${route.path}: ${failure.expected}`,
        actual: failure.actual,
        detail: [
          `stub "${p.name}" route ${route.method} ${route.path} — request assertion failed`,
          `expected: ${failure.expected}`,
          `actual:   ${failure.actual}`,
          `--- request ---`,
          ...describeRequest(method, rawUrl, headers, body),
        ],
      })
    }

    // The scripted response is served regardless: the scenario's own steps must
    // still run to their conclusion, and the violation settles at scenario end.
    const status = route.status ?? 200
    const payload =
      route.json !== undefined ? JSON.stringify(route.json) : (route.body ?? '')
    const responseHeaders: Record<string, string> = {
      ...(route.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(route.headers ?? {}),
    }
    respond(p.res, status, responseHeaders, payload)
  })
}

function respond(
  res: http.ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string,
): void {
  res.writeHead(status, headers)
  res.end(body)
}

/**
 * Exact pathname match, except for a single TRAILING `*` segment (`/v1/orders/*`)
 * which matches any non-empty remainder. Deliberately the whole matching language
 * of v1 — a stub is scripted, not a router.
 */
export function pathMatches(pattern: string, pathname: string): boolean {
  if (!pattern.endsWith('/*')) return pattern === pathname
  const prefix = pattern.slice(0, -1) // keep the trailing slash
  return pathname.startsWith(prefix) && pathname.length > prefix.length
}

interface ReceivedRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: string
}

/** The first unmet request assertion, or `null` when every one holds. */
export function evaluateStubExpect(
  expect: NonNullable<GuardHttpStubRoute['expect']>,
  received: ReceivedRequest,
): { expected: string; actual: string } | null {
  for (const needle of expect.bodyContains ?? []) {
    if (!received.body.includes(needle)) {
      return {
        expected: `request body contains ${JSON.stringify(needle)}`,
        actual: `body was ${JSON.stringify(excerpt(received.body))}`,
      }
    }
  }

  for (const [name, value] of Object.entries(expect.query ?? {})) {
    const actual = received.url.searchParams.get(name)
    if (actual !== value) {
      return {
        expected: `query "${name}" is ${JSON.stringify(value)}`,
        actual: actual === null ? `query "${name}" was absent` : `query "${name}" was ${JSON.stringify(actual)}`,
      }
    }
  }

  for (const [name, value] of Object.entries(expect.headers ?? {})) {
    const actual = received.headers[name.toLowerCase()]
    if (actual !== value) {
      return {
        expected: `header "${name}" is ${JSON.stringify(value)}`,
        actual: actual === undefined ? `header "${name}" was absent` : `header "${name}" was ${JSON.stringify(actual)}`,
      }
    }
  }

  const jsonPaths = Object.entries(expect.jsonPath ?? {})
  if (jsonPaths.length > 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(received.body)
    } catch (e) {
      return {
        expected: `a JSON request body (asserted at ${jsonPaths.map(([p]) => p || '$').join(', ')})`,
        actual: `body was not JSON (${e instanceof Error ? e.message : String(e)}): ${JSON.stringify(excerpt(received.body))}`,
      }
    }
    for (const [path, expected] of jsonPaths) {
      const label = path === '' ? 'json root' : `json ${path}`
      const value = lookupJsonPath(parsed, path)
      if (value === JSON_PATH_MISS) {
        return { expected: `${label} equals ${JSON.stringify(expected)}`, actual: `${label} was absent` }
      }
      if (!jsonEquals(value, expected)) {
        return {
          expected: `${label} equals ${JSON.stringify(expected)}`,
          actual: `${label} was ${JSON.stringify(value)}`,
        }
      }
    }
  }

  return null
}

function excerpt(text: string): string {
  return text.length > STUB_EXCERPT_LIMIT ? `${text.slice(0, STUB_EXCERPT_LIMIT)}…` : text
}

/** The received request as evidence lines (headers included — they carry the app's auth). */
function describeRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): string[] {
  const lines = [`${method} ${url}`]
  for (const [k, v] of Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${k}: ${v}`)
  }
  if (body) lines.push('', excerpt(body))
  return lines
}

/** Every request a stub received, one line each — the `calls` mismatch's evidence. */
function describeRecords(records: readonly HttpStubRequestRecord[]): string[] {
  if (records.length === 0) return ['--- requests received ---', '(none)']
  return ['--- requests received ---', ...records.map((r) => `${r.method} ${r.url}`)]
}

/**
 * Substitute `${HTTP_STUB:<name>}` with each stub's origin across a scenario's
 * `setup.env` VALUES — the one surface that reaches the app under test (the app
 * reads its dependency's base URL from the environment; a stub origin has no
 * meaning anywhere else in `setup`). Returns a NEW setup; the scenario object is
 * never mutated, so each run substitutes its own ports into the same template.
 * A placeholder naming a stub the scenario never declared is a scenario defect,
 * loud by construction: {@link CapabilityError} → the `error` outcome.
 */
export function applyHttpStubOrigins(
  setup: GuardSetup | undefined,
  origins: ReadonlyMap<string, string>,
): GuardSetup | undefined {
  if (!setup?.env) return setup
  return { ...setup, env: substituteHttpStubOriginsInEnv(setup.env, origins, 'setup.env') }
}

/**
 * The same substitution over ANY scenario-authored env map — `setup.env` above, and
 * a `boot` step's per-boot overlay, which points the app at a stub for that boot
 * only. `label` names the map in the defect message so the two are told apart.
 */
export function substituteHttpStubOriginsInEnv(
  env: Record<string, string>,
  origins: ReadonlyMap<string, string>,
  label: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value.replace(STUB_PLACEHOLDER_RE, (_match, name: string) => {
        const origin = origins.get(name)
        if (origin === undefined) {
          throw new CapabilityError(
            CAPABILITY,
            `${label}.${key} references \${HTTP_STUB:${name}}, but no stub named "${name}" is declared in setup.http`,
          )
        }
        return origin
      }),
    ]),
  )
}
