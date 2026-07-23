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
 * Every response carries `x-service: todos`.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('PORT env var is required')
  process.exit(1)
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

// --- Concurrency instrumentation (test control) ------------------------------------
// TC_HOLD_DIR (live-marker dir) + TC_HOLD_SAMPLES (append file): each `/hold` request
// registers a marker, samples how many are live NOW, appends the count, then releases
// after TC_HOLD_MS — so the test reads the MAX concurrent api scenarios (== resident
// servers, each held for its scenario's life) as the peak sample.
const HOLD_DIR = process.env.TC_HOLD_DIR
const HOLD_SAMPLES = process.env.TC_HOLD_SAMPLES
const HOLD_MS = Number(process.env.TC_HOLD_MS ?? 200)

const STATE_FILE = './todos.json'
const state = { nextId: 1, todos: [] }
if (fs.existsSync(STATE_FILE)) {
  const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  state.nextId = loaded.nextId
  state.todos = loaded.todos
}
const persist = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

const send = (res, status, payload) => {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  res.writeHead(status, {
    'x-service': 'todos',
    ...(body ? { 'content-type': 'application/json' } : {}),
  })
  res.end(body)
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)

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

  // Reflects the request back — path, query params, Authorization header, and body.
  // Used to prove fixture placeholders reached the wire in path/query/body, and that
  // a seed-provided credential reached the header.
  if (url.pathname === '/echo' || url.pathname.startsWith('/echo/')) {
    const body = await readBody(req)
    return send(res, 200, {
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers['authorization'] ?? '',
      body,
    })
  }

  if (req.method === 'GET' && url.pathname === '/boom') {
    console.error('kaboom at /boom — fixture stack line')
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
