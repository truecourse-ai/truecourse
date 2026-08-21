#!/usr/bin/env node
/**
 * Fixture HTTP API ("todos") for guard api-driver tests — dependency-free
 * `node:http`. Honors the runner contract: listens on `PORT` (required), and
 * persists its state to `./todos.json` in the CWD it was started in, so each
 * guard sandbox gets isolated state for free.
 *
 * Surface:
 *   GET    /health         → 200 {"ok":true}
 *   GET    /todos          → 200 {"todos":[…]}
 *   POST   /todos          → 201 the created todo | 400 {"error":"title is required"}
 *   GET    /todos/:id      → 200 the todo | 404 {"error":"todo not found"}
 *   PATCH  /todos/:id      → 200 the updated todo | 404
 *   DELETE /todos/:id      → 204 (empty)
 *   GET    /boom           → 500 {"error":"kaboom"} (logs a stack line to stderr)
 *   GET    /boom-loud      → the same 500, but the stack line trails a dump larger
 *                            than the OS pipe buffer (TC_BOOM_DUMP_BYTES)
 *   GET    /log-on-go      → 200 {"ok":true}; then ONE stderr line, gated on
 *                            <TC_LOG_ON_GO>/go and acknowledged via .../done
 *   ANY    /upstream       → calls TC_UPSTREAM_BASE (the stubbed third party) and
 *                            reports {"upstreamStatus","upstreamBody"}
 *   GET    /startup-ping   → what the TC_UPSTREAM_PING boot-time call saw
 *   POST   /login          → 200, sets a `sid` session cookie (+ `x-token` header)
 *                            ?ttl=<s>   Max-Age on the cookie (0 ⇒ already expired)
 *                            ?path=<p>  Path attribute (default `/`)
 *   GET    /me             → 200 {"user"} with a valid `sid` cookie | 401
 *   GET    /redirect       → 302 with `Location: /todos/1` (never followed)
 *   POST   /auth/token     → 200 {"token"} — a STATELESS token (hmac of the user with
 *                            TC_TOKEN_SECRET), so any later boot accepts it; also
 *                            echoed as the `x-token` response header.
 *                            ?omit=1 answers 200 {} (no token — a capture miss)
 *   GET    /whoami         → 200 {"user"} with `Authorization: Bearer <token>` | 401
 *   GET    /whoami-raw     → 200 {"user"} with a BARE `Authorization: <token>` | 401
 * Every response carries `x-service: todos`.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Port source: `--port <n>` in argv when given (the uvicorn/ASP.NET shape the
// `${PORT}` placeholder exists for — an unsubstituted placeholder is a hard exit,
// never a silent fall back to the env var), else the `PORT` env var.
const argvPortIndex = process.argv.indexOf('--port')
let port
if (argvPortIndex !== -1) {
  port = Number(process.argv[argvPortIndex + 1])
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`--port needs a port number, got ${process.argv[argvPortIndex + 1]}`)
    process.exit(1)
  }
} else {
  port = Number(process.env.PORT)
  if (!Number.isInteger(port) || port <= 0) {
    console.error('PORT env var is required')
    process.exit(1)
  }
}

// --- Boot-failure injection (test control; scoped to a scenario's setup.env so it
// never trips the run-level preflight boot, which carries only the recipe env) ------
// Two distinct FAILURE CLASSES, because the runner retries only one of them:
//   TC_FAIL_BOOT — DETERMINISTIC early exit: print a distinctive line (and echo TC_LEAK,
//     a stand-in for a resolved credential, to prove redaction) then exit nonzero. NOT
//     retried — a retry would just re-crash.
//   TC_HEALTH_FAIL — HEALTH-TIMEOUT: the process listens but answers /health non-2xx, so
//     the boot times out. This is the transient-pressure class the runner retries.
//   TC_HEALTH_FAIL_ONCE=<flagFile> — health-timeout iff the flag is absent (creating it),
//     healthy once it exists: a transient first boot that a lone retry clears.
if (process.env.TC_FAIL_BOOT) {
  console.error('boot-fail: fixture refused to boot')
  if (process.env.TC_LEAK) console.log(`boot env leaked TC_LEAK=${process.env.TC_LEAK}`)
  process.exit(1)
}
// Decided ONCE at startup so a given process is consistently healthy or not.
let healthOk = true
if (process.env.TC_HEALTH_FAIL) {
  healthOk = false
} else if (process.env.TC_HEALTH_FAIL_ONCE) {
  const flag = process.env.TC_HEALTH_FAIL_ONCE
  if (!fs.existsSync(flag)) {
    fs.writeFileSync(flag, '1')
    healthOk = false // this (first) boot never turns healthy → times out; the retry clears it
  }
}

// TC_LOG_THEN_MARK=<file> (test control): write ONE stderr line and only then create
// the marker file, so a parent that observes the marker knows the write is already in
// the capture. There is deliberately NO knob for holding the line back inside this
// process (the pipe era had one, `TC_LOG_RELEASE_MS`): stdio is captured to FILES, so
// a write is complete when the syscall returns — a `cork()` here would model nothing
// the runner can see, and would fail the drain test for a reason that is not the
// runner's.
if (process.env.TC_LOG_THEN_MARK) {
  console.error('drain-probe: stderr written before the marker file')
  fs.writeFileSync(process.env.TC_LOG_THEN_MARK, '1')
}

// TC_LOG_ON_GO=<dir> (test control): `GET /log-on-go` answers immediately, and the
// ONE stderr line it then writes waits for `<dir>/go` to exist; `<dir>/done` is
// created only after the line is written (pipe writes are synchronous on POSIX, so
// "written" means "in the pipe"). A parent that creates `go` and spins on `done`
// WITHOUT yielding therefore holds stderr bytes that are provably in the pipe and
// provably unread — the guaranteed state for testing where a capture boundary
// puts bytes that are in flight when a step ends.
const LOG_ON_GO = process.env.TC_LOG_ON_GO

// --- Concurrency instrumentation (test control) ------------------------------------
// TC_HOLD_DIR (live-marker dir) + TC_HOLD_SAMPLES (append file): each `/hold` request
// registers a marker, samples how many are live NOW, appends the count, then releases
// after TC_HOLD_MS — so the test reads the MAX concurrent api scenarios (== resident
// servers, each held for its scenario's life) as the peak sample.
const HOLD_DIR = process.env.TC_HOLD_DIR
const HOLD_SAMPLES = process.env.TC_HOLD_SAMPLES
const HOLD_MS = Number(process.env.TC_HOLD_MS ?? 200)

// --- Outbound third-party calls (setup.http stub target) ---------------------------
// TC_UPSTREAM_BASE is the base URL of the "third party" this fixture depends on — the
// env var a `setup.http` stub's `${HTTP_STUB:<name>}` origin is substituted into.
// TC_UPSTREAM_PING makes the fixture call it AT STARTUP, before it listens: the stub
// must already be up or the ping fails, which is how a test proves the ordering.
const UPSTREAM_BASE = process.env.TC_UPSTREAM_BASE || ''
let startupPing = null
if (UPSTREAM_BASE && process.env.TC_UPSTREAM_PING) {
  try {
    const res = await fetch(`${UPSTREAM_BASE}${process.env.TC_UPSTREAM_PING}`)
    startupPing = { status: res.status, body: await res.text() }
  } catch (err) {
    startupPing = { status: 0, body: `startup ping failed: ${err.message}` }
  }
}

const STATE_FILE = './todos.json'
const state = { nextId: 1, todos: [] }
if (fs.existsSync(STATE_FILE)) {
  const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  state.nextId = loaded.nextId
  state.todos = loaded.todos
}
const persist = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

const send = (res, status, payload, extraHeaders = {}) => {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  res.writeHead(status, {
    'x-service': 'todos',
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...extraHeaders,
  })
  res.end(body)
}

// --- Auth (cookie sessions + stateless tokens) --------------------------------------
// Sessions are per-BOOT (in memory): that is exactly the cookie-jar contract — a login
// and the calls that use it live inside ONE scenario, against ONE server.
const sessions = new Map()
let nextSession = 1

/** The `sid` cookie value on an incoming request, or ''. */
const readSid = (req) => {
  const raw = req.headers['cookie'] ?? ''
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === 'sid') return rest.join('=')
  }
  return ''
}

// The token is a pure function of (user, secret) — no server state — so a token minted
// against the run-level preflight boot is still valid to every scenario's own boot.
// This is the JWT-shaped case `fromRequest` is correct for.
const TOKEN_SECRET = process.env.TC_TOKEN_SECRET || 'fixture-secret'
const mintToken = (user) =>
  crypto.createHmac('sha256', TOKEN_SECRET).update(user).digest('hex').slice(0, 32)
/** The user a presented token authenticates, or ''. Tokens are per-user, checked by recompute. */
const userForToken = (token) => {
  for (const user of ['owner', 'member']) if (token && mintToken(user) === token) return user
  return ''
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })

// TC_BASE_PATH (test control): strip this leading path prefix before routing, so the
// fixture can stand in for a server mounted under an OpenAPI `servers` base path
// (e.g. `/api/v1`). Requests without the prefix (like a bare `/health` boot check)
// route unchanged.
const BASE_PATH = process.env.TC_BASE_PATH || ''

// One stdout line per request, written when the response finishes — the shape a
// `logs` step asserts on ("method path status duration"). Unconditional: a request
// log is what a real service does, and the boot banner already shares this stream.
const server = http.createServer(async (req, res) => {
  const started = Date.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`)
  })
  const url = new URL(req.url, 'http://localhost')
  if (BASE_PATH && url.pathname.startsWith(BASE_PATH)) {
    url.pathname = url.pathname.slice(BASE_PATH.length) || '/'
  }
  const parts = url.pathname.split('/').filter(Boolean)

  // Boot reflection (test control): the argv tail the process was spawned with, the
  // port it actually bound, and its TC_* env — how a test proves `${PORT}` was
  // substituted into the serve argv and into env VALUES, not just injected as PORT.
  if (req.method === 'GET' && url.pathname === '/boot') {
    return send(res, 200, {
      port,
      argv: process.argv.slice(2),
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('TC_'))),
    })
  }

  if (req.method === 'GET' && url.pathname === '/health')
    return healthOk ? send(res, 200, { ok: true }) : send(res, 503, { ok: false })

  // Concurrency probe: hold the request open while a marker is live, so overlapping
  // scenarios reveal the true parallel-server count. See the instrumentation note above.
  if (req.method === 'GET' && url.pathname === '/hold' && HOLD_DIR) {
    const marker = path.join(HOLD_DIR, `${port}-${crypto.randomUUID()}`)
    fs.writeFileSync(marker, '')
    const live = fs.readdirSync(HOLD_DIR).length
    if (HOLD_SAMPLES) fs.appendFileSync(HOLD_SAMPLES, `${live}\n`)
    await new Promise((r) => setTimeout(r, HOLD_MS))
    fs.unlinkSync(marker)
    return send(res, 200, { concurrency: live })
  }

  // Reflects the Authorization header into the body AND logs it to stderr — the two
  // ways a real service can leak an injected credential into guard evidence.
  if (req.method === 'GET' && url.pathname === '/echo-auth') {
    const auth = req.headers['authorization'] ?? ''
    console.error(`request authorized with ${auth}`)
    return send(res, 200, { authorization: auth })
  }

  // Reflects the request back — path, query params, Authorization and Origin headers, and body.
  // Used to prove fixture placeholders reached the wire in path/query/body, and that
  // a seed-provided credential reached the header.
  if (url.pathname === '/echo' || url.pathname.startsWith('/echo/')) {
    const body = await readBody(req)
    return send(res, 200, {
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers['authorization'] ?? '',
      origin: req.headers['origin'] ?? '',
      body,
    })
  }

  // Calls the "third party" at TC_UPSTREAM_BASE and reports what it answered:
  //   ?path=/v1/x   the upstream path (default `/`), query string included
  //   ?method=POST  the upstream method (default GET)
  // The incoming body and the `authorization` / `x-api-key` headers are forwarded, so
  // a stub's request assertions have something real to assert on.
  if (url.pathname === '/upstream') {
    if (!UPSTREAM_BASE) return send(res, 503, { error: 'TC_UPSTREAM_BASE is not set' })
    const body = await readBody(req)
    const method = (url.searchParams.get('method') || 'GET').toUpperCase()
    const target = `${UPSTREAM_BASE}${url.searchParams.get('path') || '/'}`
    const headers = { 'content-type': 'application/json' }
    if (req.headers['authorization']) headers['authorization'] = req.headers['authorization']
    if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key']
    try {
      const upstream = await fetch(target, {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' || !body ? {} : { body }),
      })
      return send(res, 200, { upstreamStatus: upstream.status, upstreamBody: await upstream.text() })
    } catch (err) {
      return send(res, 502, { error: `upstream call failed: ${err.message}` })
    }
  }

  // What the startup ping (TC_UPSTREAM_PING) saw — proof the stub was up before the app.
  if (req.method === 'GET' && url.pathname === '/startup-ping') {
    return send(res, 200, { ping: startupPing })
  }

  // --- Cookie sessions -------------------------------------------------------------
  // Mints a session and hands it back as a `Set-Cookie` — the header the runner's
  // per-scenario jar stores and replays. `ttl`/`path` let a test drive expiry and
  // path-scoping; `x-token` gives `captureHeaders` something to read on the same call.
  if (req.method === 'POST' && url.pathname === '/login') {
    const body = await readBody(req)
    let user = 'owner'
    try {
      const parsed = JSON.parse(body || '{}')
      if (typeof parsed.user === 'string' && parsed.user) user = parsed.user
    } catch {
      // a bodyless login is fine — it authenticates the default user
    }
    const sid = `sess-${nextSession++}`
    sessions.set(sid, user)
    const ttl = url.searchParams.get('ttl')
    const cookiePath = url.searchParams.get('path') || '/'
    const attrs = [`sid=${sid}`, `Path=${cookiePath}`, 'HttpOnly', 'SameSite=Lax']
    if (ttl !== null) attrs.push(`Max-Age=${ttl}`)
    return send(res, 200, { ok: true, user }, { 'set-cookie': attrs.join('; '), 'x-token': mintToken(user) })
  }

  if (req.method === 'GET' && url.pathname === '/me') {
    const user = sessions.get(readSid(req))
    return user ? send(res, 200, { user }) : send(res, 401, { error: 'not authenticated' })
  }

  // A redirect the runner never follows (`redirect: 'manual'`) — so `Location` is a
  // response header a step can capture.
  if (req.method === 'GET' && url.pathname === '/redirect') {
    return send(res, 302, undefined, { location: '/todos/1' })
  }

  // --- Stateless tokens (the `fromRequest` credential source) ------------------------
  if (req.method === 'POST' && url.pathname === '/auth/token') {
    const body = await readBody(req)
    let user = 'owner'
    try {
      const parsed = JSON.parse(body || '{}')
      if (typeof parsed.user === 'string' && parsed.user) user = parsed.user
    } catch {
      // fall through with the default user
    }
    const token = mintToken(user)
    if (url.searchParams.get('omit')) return send(res, 200, { ok: true })
    return send(res, 200, { token, user }, { 'x-token': token })
  }

  if (req.method === 'GET' && url.pathname === '/whoami') {
    const auth = req.headers['authorization'] ?? ''
    const user = auth.startsWith('Bearer ') ? userForToken(auth.slice('Bearer '.length)) : ''
    return user ? send(res, 200, { user }) : send(res, 401, { error: 'not authenticated' })
  }

  // The scheme-less twin: proves a `fromRequest` value is injected VERBATIM unless a
  // `template` opts into a prefix.
  if (req.method === 'GET' && url.pathname === '/whoami-raw') {
    const user = userForToken(req.headers['authorization'] ?? '')
    return user ? send(res, 200, { user }) : send(res, 401, { error: 'not authenticated' })
  }

  // See TC_LOG_ON_GO above: respond first, write the stderr line only when poked.
  if (req.method === 'GET' && url.pathname === '/log-on-go' && LOG_ON_GO) {
    send(res, 200, { ok: true })
    const waitForGo = () => {
      if (!fs.existsSync(path.join(LOG_ON_GO, 'go'))) return void setTimeout(waitForGo, 1)
      console.error('late-probe: stderr written while the runner was between steps')
      fs.writeFileSync(path.join(LOG_ON_GO, 'done'), '1')
    }
    waitForGo()
    return
  }

  if (req.method === 'GET' && url.pathname === '/boom') {
    console.error('kaboom at /boom — fixture stack line')
    return send(res, 500, { error: 'kaboom' })
  }

  // The loud twin: the stack line trails a dump the OS pipe cannot hold in one go,
  // so when the 500 reaches the runner the tail of the dump is provably still
  // unread. That makes the runner's stdio flush barrier testable without any timing
  // assumption — un-drained, the excerpt's TAIL carries dump and no stack line.
  if (req.method === 'GET' && url.pathname === '/boom-loud') {
    console.error('x'.repeat(Number(process.env.TC_BOOM_DUMP_BYTES ?? 200_000)))
    console.error('kaboom at /boom-loud — fixture stack line')
    return send(res, 500, { error: 'kaboom' })
  }

  if (parts[0] === 'todos') {
    if (parts.length === 1) {
      if (req.method === 'GET') return send(res, 200, { todos: state.todos })
      if (req.method === 'POST') {
        let parsed
        try {
          parsed = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return send(res, 400, { error: 'body must be JSON' })
        }
        if (typeof parsed.title !== 'string' || parsed.title.length === 0) {
          return send(res, 400, { error: 'title is required' })
        }
        const todo = { id: state.nextId++, title: parsed.title, done: false }
        state.todos.push(todo)
        persist()
        return send(res, 201, todo)
      }
    }
    if (parts.length === 2) {
      const todo = state.todos.find((t) => t.id === Number(parts[1]))
      if (req.method === 'GET') {
        return todo ? send(res, 200, todo) : send(res, 404, { error: 'todo not found' })
      }
      if (req.method === 'PATCH') {
        if (!todo) return send(res, 404, { error: 'todo not found' })
        let parsed
        try {
          parsed = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return send(res, 400, { error: 'body must be JSON' })
        }
        if (typeof parsed.done === 'boolean') todo.done = parsed.done
        if (typeof parsed.title === 'string' && parsed.title.length > 0) todo.title = parsed.title
        persist()
        return send(res, 200, todo)
      }
      if (req.method === 'DELETE') {
        if (!todo) return send(res, 404, { error: 'todo not found' })
        state.todos = state.todos.filter((t) => t !== todo)
        persist()
        return send(res, 204)
      }
    }
  }

  return send(res, 404, { error: 'not found' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`todos fixture listening on ${port}`)
})

// Graceful shutdown: stop accepting connections and exit 0 — the claim a `signal`
// step asserts. `TC_SHUTDOWN_EXIT` (test control) makes the exit code something
// else, so a MISMATCHED expectation is testable too; `TC_IGNORE_SIGNALS` swallows
// the signal entirely, which is how the exit-timeout path is exercised.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (process.env.TC_IGNORE_SIGNALS) {
      console.error(`ignoring ${sig}`)
      return
    }
    console.log(`${sig} received — shutting down`)
    server.close(() => process.exit(Number(process.env.TC_SHUTDOWN_EXIT ?? 0)))
    // Keep-alive sockets left over from earlier requests are idle, and `close()`
    // waits for them; releasing them is what makes the shutdown finish promptly
    // without dropping an in-flight response.
    server.closeIdleConnections?.()
  })
}
