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

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('PORT env var is required')
  process.exit(1)
}

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

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true })

  // Reflects the Authorization header into the body AND logs it to stderr — the two
  // ways a real service can leak an injected credential into guard evidence.
  if (req.method === 'GET' && url.pathname === '/echo-auth') {
    const auth = req.headers['authorization'] ?? ''
    console.error(`request authorized with ${auth}`)
    return send(res, 200, { authorization: auth })
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
