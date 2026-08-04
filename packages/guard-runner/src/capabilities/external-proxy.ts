/**
 * The `externals` setup capability — the ALWAYS-ON fault-injection proxy in front of
 * every user-provided external service.
 *
 * A user can hand guard a real or sandbox account for a third party, and the
 * runner then points the app's base-URL env var at that account. This layer puts a
 * runner-managed loopback proxy in between, UNCONDITIONALLY: every base-URL
 * variable of every provided service is pointed at a per-scenario proxy whose
 * upstream is the real origin. Unscripted traffic is forwarded verbatim, so a
 * scenario that says nothing behaves exactly as it did before this capability
 * existed — while ANY scenario can now script a fault without the user configuring
 * anything.
 *
 * That "always on" is the whole design. A proxy that only appears when a scenario
 * asks for it would have to be wired by the scenario (a base-URL override the
 * author must remember, and must not get wrong), and a half-proxied vendor — one
 * host through the proxy, another straight to the internet — is exactly the kind of
 * confident silence this design refuses.
 *
 * Lifecycle mirrors the `http` stubs: a LIVE capability, started per scenario
 * BEFORE the sandbox env is built (the app reads the origin from its environment at
 * boot, so the port must exist first) and stopped when the scenario finishes. One
 * proxy per (service, base-URL env var); all endpoints of ONE service share that
 * service's fault script and its call log, because "open-meteo was called twice" is
 * a fact about the service, not about one of its hosts.
 *
 * Failure semantics mirror `setup.http` exactly:
 *   - a proxy that cannot BOOT, or a `setup.externals` entry naming a service that
 *     is not declared+provided → {@link CapabilityError} → the scenario's `error`
 *     outcome;
 *   - a `calls` count mismatch → the scenario FAILS, with the calls it did receive
 *     excerpted (through the scenario's redactor — an app forwards its upstream key
 *     on every one of these requests);
 *   - a scripted FAULT is never a failure. It is the world the scenario declared.
 */

import http from 'node:http'
import https from 'node:https'
import type { Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { GuardExternal, GuardExternalFault, GuardSetup } from '@truecourse/shared'
import { CapabilityError } from './index.js'
import { pathMatches } from './http.js'
import type { ExternalProxyTarget } from '../externals.js'

/** The capability name, as it appears in a {@link CapabilityError} message. */
const CAPABILITY = 'externals'

/** Per-field cap on recorded request text, matching the http capability's excerpt. */
const CALL_EXCERPT_LIMIT = 1200

/** Cap on the calls one service retains — a runaway client cannot exhaust memory. */
const MAX_RECORDED_CALLS = 200

/**
 * Headers that describe ONE hop and must never be relayed (RFC 9110 §7.6.1).
 * `host` is handled separately: it is rewritten to the upstream's authority, since
 * the app addressed the proxy but the real service routes on its own name.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** One call the app made to a provided service, as the proxy saw it. */
export interface ExternalCallRecord {
  /** The service the call was addressed to. */
  service: string
  /** The base-URL env var (hence the endpoint) it came in on. */
  envVar: string
  method: string
  /** Path incl. query string, as sent. */
  url: string
  /** Lower-cased header names, as sent (auth included — redact before display). */
  headers: Record<string, string>
  /** Raw request body (truncated to {@link CALL_EXCERPT_LIMIT}). */
  body: string
  /** How the proxy answered: forwarded upstream, or the fault rule that fired. */
  outcome: 'passthrough' | 'respond' | 'refuse'
  /** Index of the fault rule that fired; absent on a passthrough. */
  faultIndex?: number
}

/** A scenario-failing externals finding. Only `calls` can fail — faults cannot. */
export interface ExternalProxyViolation {
  service: string
  kind: 'calls'
  expected: string
  actual: string
  /** Multi-line evidence (the calls received, excerpted). */
  detail: string[]
}

export interface ExternalProxiesHandle {
  /** base-URL env var → `http://127.0.0.1:<port>` (the value injected at boot). */
  env: Readonly<Record<string, string>>
  /** Every call every provided service received, in arrival order (for evidence). */
  records(): readonly ExternalCallRecord[]
  /**
   * The FIRST violation the scenario should fail on, or `null`. Called at scenario
   * end: only `calls` assertions can fail — a scripted fault is the declared world,
   * never a finding.
   */
  settle(): ExternalProxyViolation | null
  /** Close every proxy server. Idempotent. */
  stop(): Promise<void>
}

export interface StartExternalProxiesOptions {
  /** Every PROVIDED external and its base-URL variables (see `externalProxyTargets`). */
  targets: readonly ExternalProxyTarget[]
  /** The scenario's `setup.externals` fault script, when it wrote one. */
  scripts: GuardSetup['externals'] | undefined
  /**
   * Env var names the scenario's own `setup.env` sets. A variable a scenario points
   * somewhere else (`${HTTP_STUB:…}`) is NOT proxied — its traffic is not going to
   * the provided account at all — and no port is spent on it.
   */
  overriddenEnv?: Iterable<string>
}

interface EndpointServer {
  server: http.Server
  sockets: Set<Socket>
}

/** One service's live state: its script, its call log, and its consumed rules. */
interface ServiceState {
  script: GuardExternal | undefined
  calls: ExternalCallRecord[]
  /** Total calls received — counted even past {@link MAX_RECORDED_CALLS}. */
  count: number
  consumed: Set<number>
}

/**
 * Boot one loopback proxy per (provided service, base-URL env var). Returns `null`
 * when the run has no provided externals and the scenario scripts none, so a repo
 * without external accounts pays nothing.
 *
 * BOOT IS EAGER, deliberately: the app can call its upstream during STARTUP (a
 * warm-up ping, a token fetch), so the origin must be in the environment before the
 * server process exists — there is no first-call moment to bind lazily at. The only
 * proxy skipped is one whose variable the scenario overrides itself. A loopback
 * listener on an ephemeral port costs microseconds and one fd.
 */
export async function startExternalProxies(
  opts: StartExternalProxiesOptions,
): Promise<ExternalProxiesHandle | null> {
  const scripts = opts.scripts ?? {}
  const provided = new Map(opts.targets.map((t) => [t.service, t]))

  // A fault script for a service the run cannot reach is a scenario defect: the
  // scenario believes it is controlling a live dependency that is not there. Loud,
  // exactly like `${HTTP_STUB:…}` naming an undeclared stub.
  for (const service of Object.keys(scripts)) {
    if (provided.has(service)) continue
    throw new CapabilityError(
      CAPABILITY,
      `setup.externals references "${service}", but no external service named "${service}" is declared in the recipe's api.externals AND provided on this machine` +
        (provided.size > 0
          ? ` (provided: ${[...provided.keys()].join(', ')})`
          : ' (no external service is provided — run `truecourse guard externals` to supply an account, or stub it with setup.http)'),
    )
  }

  if (opts.targets.length === 0) return null

  const overridden = new Set(opts.overriddenEnv ?? [])
  const states = new Map<string, ServiceState>()
  const servers: EndpointServer[] = []
  const env: Record<string, string> = {}

  const closeAll = async (): Promise<void> => {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            for (const socket of s.sockets) socket.destroy()
            s.server.closeAllConnections?.()
            s.server.close(() => resolve())
          }),
      ),
    )
  }

  for (const target of opts.targets) {
    const state: ServiceState = {
      script: scripts[target.service],
      calls: [],
      count: 0,
      consumed: new Set(),
    }
    states.set(target.service, state)
    for (const endpoint of target.endpoints) {
      // The scenario pointed this variable somewhere of its own (a stub): its
      // traffic never reaches the provided account, so proxying it would be a lie.
      if (overridden.has(endpoint.envVar)) continue
      const sockets = new Set<Socket>()
      const server = http.createServer((req, res) => {
        void handleProxyRequest({
          service: target.service,
          envVar: endpoint.envVar,
          upstream: endpoint.url,
          state,
          req,
          res,
        })
      })
      server.on('connection', (socket) => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
      })
      const entry: EndpointServer = { server, sockets }
      servers.push(entry)
      try {
        await listen(server)
      } catch (e) {
        await closeAll()
        throw new CapabilityError(
          CAPABILITY,
          `proxy for "${target.service}" (${endpoint.envVar} → ${endpoint.url}) could not start: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      const address = server.address() as AddressInfo
      env[endpoint.envVar] = `http://127.0.0.1:${address.port}`
    }
  }

  return {
    env,
    records: () => [...states.values()].flatMap((s) => s.calls),
    settle() {
      for (const [service, state] of states) {
        const expected = state.script?.calls
        if (expected === undefined || expected === state.count) continue
        return {
          service,
          kind: 'calls',
          expected: `external service "${service}" to be called ${expected} time(s)`,
          actual: `it was called ${state.count} time(s)`,
          detail: [
            `external service "${service}"`,
            `expected calls: ${expected}`,
            `actual calls:   ${state.count}`,
            ...describeCalls(state.calls),
          ],
        }
      }
      return null
    },
    stop: closeAll,
  }
}

/** Bind one proxy server to an ephemeral loopback port. */
function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

interface ProxyParams {
  service: string
  envVar: string
  upstream: string
  state: ServiceState
  req: http.IncomingMessage
  res: http.ServerResponse
}

/**
 * One proxied call: buffer the body (it is both forwarded and recorded), pick the
 * fault rule that applies, then delay / respond / refuse / forward.
 */
async function handleProxyRequest(p: ProxyParams): Promise<void> {
  // A scripted delay outlives the app's own timeout by design, so the client is
  // routinely gone before the answer is written. That is the scenario working, not
  // an error — swallow the socket teardown instead of letting it reach the runner
  // as an unhandled 'error' event.
  p.res.on('error', () => {})
  p.req.on('error', () => {})
  const body = await readBody(p.req)
  const method = (p.req.method ?? 'GET').toUpperCase()
  const rawUrl = p.req.url ?? '/'
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(p.req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ')
  }

  p.state.count += 1
  const fault = selectFault(p.state, method, rawUrl)
  const record: ExternalCallRecord = {
    service: p.service,
    envVar: p.envVar,
    method,
    url: rawUrl,
    headers,
    body: body.toString('utf-8').slice(0, CALL_EXCERPT_LIMIT),
    outcome: fault?.rule.refuse ? 'refuse' : fault?.rule.respond ? 'respond' : 'passthrough',
    ...(fault ? { faultIndex: fault.index } : {}),
  }
  if (p.state.calls.length < MAX_RECORDED_CALLS) p.state.calls.push(record)

  // `delayMs` composes with everything: delay-then-respond scripts a slow error,
  // delay-then-forward scripts an upstream slower than the app's own timeout.
  if (fault?.rule.delayMs) await sleep(fault.rule.delayMs)

  if (fault?.rule.refuse) {
    // Unanswered and destroyed — the app sees a reset connection, which is what a
    // refused/dead upstream looks like from inside its HTTP client.
    p.res.socket?.destroy()
    p.res.destroy()
    return
  }

  const respond = fault?.rule.respond
  if (respond) {
    const payload =
      respond.json !== undefined ? JSON.stringify(respond.json) : (respond.body ?? '')
    p.res.writeHead(respond.status, {
      ...(respond.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(respond.headers ?? {}),
    })
    p.res.end(payload)
    return
  }

  forward(p, method, rawUrl, body)
}

/** Read the whole request body — it is both forwarded upstream and recorded. */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.concat(chunks)))
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The fault rule that applies to this call, or `null` for a passthrough. Rules are
 * scanned in declaration order, skipping ones a `once` already consumed; the first
 * whose `match` applies wins, and firing a `once` rule consumes it — which is how
 * `[{refuse, once}, {}]` means "the first call fails, the next succeeds". A rule
 * carrying only `match` selects a passthrough EXPLICITLY (it still consumes, so it
 * can sit in a sequence).
 */
function selectFault(
  state: ServiceState,
  method: string,
  rawUrl: string,
): { rule: GuardExternalFault; index: number } | null {
  const faults = state.script?.faults ?? []
  const pathname = new URL(rawUrl, 'http://external.invalid').pathname
  for (const [index, rule] of faults.entries()) {
    if (state.consumed.has(index)) continue
    if (rule.match?.method && rule.match.method !== method) continue
    if (rule.match?.path && !pathMatches(rule.match.path, pathname)) continue
    if (rule.once) state.consumed.add(index)
    // A match-only rule is an explicit passthrough: consumed, but nothing to do.
    if (rule.respond === undefined && rule.refuse === undefined && rule.delayMs === undefined) {
      return null
    }
    return { rule, index }
  }
  return null
}

/** Forward the call to the real service and stream its answer straight back. */
function forward(p: ProxyParams, method: string, rawUrl: string, body: Buffer): void {
  const upstream = new URL(p.upstream)
  // A base URL may carry a PATH PREFIX (`https://api.vendor.com/v1`); the app's own
  // request path is appended to it, never resolved against it (which would discard
  // the prefix). Everything after the app's path — its query string — rides along.
  const prefix = upstream.pathname.replace(/\/$/, '')
  const upstreamPath = `${prefix}${rawUrl}`
  const secure = upstream.protocol === 'https:'
  const outboundHeaders: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(p.req.headers)) {
    if (value === undefined) continue
    if (HOP_BY_HOP.has(name.toLowerCase()) || name.toLowerCase() === 'host') continue
    outboundHeaders[name] = value
  }
  // The app addressed the proxy; the real service routes on its OWN authority.
  outboundHeaders.host = upstream.host
  if (body.length > 0) outboundHeaders['content-length'] = String(body.length)

  const request = (secure ? https : http).request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (secure ? 443 : 80),
      method,
      path: upstreamPath,
      headers: outboundHeaders,
    },
    (upstreamRes) => {
      const responseHeaders: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue
        responseHeaders[name] = value
      }
      p.res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders)
      upstreamRes.pipe(p.res)
    },
  )
  request.on('error', () => {
    // The REAL service is unreachable. The app must see what it would have seen
    // talking to it directly — a broken connection, not a proxy-invented 502 that
    // its error handling would read as an upstream reply.
    p.res.socket?.destroy()
    p.res.destroy()
  })
  if (body.length > 0) request.write(body)
  request.end()
}

/** Every call a service received, one line each — the `calls` mismatch's evidence. */
function describeCalls(calls: readonly ExternalCallRecord[]): string[] {
  if (calls.length === 0) return ['--- calls received ---', '(none)']
  return [
    '--- calls received ---',
    ...calls.map((c) => `${c.method} ${c.url} → ${c.outcome}${c.faultIndex !== undefined ? ` (fault ${c.faultIndex + 1})` : ''}`),
  ]
}
