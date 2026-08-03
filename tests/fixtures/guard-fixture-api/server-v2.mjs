#!/usr/bin/env node
/**
 * The SECOND fixture HTTP API ("api-v2") — a dependency-free `node:http` twin of
 * `server.mjs`, for the multi-server recipe tests. It exists to make
 * "which server answered?" observable: every response carries `x-service: api-v2`,
 * and its whole surface lives under `/v2`, which the todos fixture 404s.
 *
 * Surface:
 *   GET  /v2/health   → 200 {"ok":true}
 *   GET  /v2/ping     → 200 {"service":"api-v2"}
 *   GET  /v2/echo     → 200 {"authorization"} — what credential reached this server
 *   POST /v2/auth/token → 200 {"token"} (+ `x-token` header), a stateless token
 *   ANY  else         → 404 {"error":"not found"}
 *
 * Same PORT contract as `server.mjs`: `--port <n>` in argv wins, else the `PORT`
 * env var; neither present is a hard exit. `TC_V2_MARKER` (test control) writes a
 * file at boot, so a test can prove a declared-but-unused server never booted.
 */

import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'

const argvPortIndex = process.argv.indexOf('--port')
let port
if (argvPortIndex !== -1) {
  port = Number(process.argv[argvPortIndex + 1])
} else {
  port = Number(process.env.PORT)
}
if (!Number.isInteger(port) || port <= 0) {
  console.error('api-v2 fixture needs a port (PORT env var or --port)')
  process.exit(1)
}

// Boot marker (test control): proves this server was started at all.
if (process.env.TC_V2_MARKER) fs.appendFileSync(process.env.TC_V2_MARKER, `${port}\n`)

// Deterministic boot failure, for the "the second server does not start" test.
if (process.env.TC_V2_FAIL_BOOT) {
  console.error('api-v2 refused to boot')
  process.exit(1)
}

const TOKEN_SECRET = process.env.TC_TOKEN_SECRET || 'fixture-secret'
const mintToken = (user) =>
  crypto.createHmac('sha256', TOKEN_SECRET).update(`v2:${user}`).digest('hex').slice(0, 32)

const send = (res, status, payload, extraHeaders = {}) => {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  res.writeHead(status, {
    'x-service': 'api-v2',
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...extraHeaders,
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/v2/health') return send(res, 200, { ok: true })
  if (req.method === 'GET' && url.pathname === '/v2/ping') return send(res, 200, { service: 'api-v2' })
  if (req.method === 'GET' && url.pathname === '/v2/echo') {
    return send(res, 200, { authorization: req.headers['authorization'] ?? '' })
  }
  if (req.method === 'POST' && url.pathname === '/v2/auth/token') {
    const token = mintToken('owner')
    return send(res, 200, { token, user: 'owner' }, { 'x-token': token })
  }
  return send(res, 404, { error: 'not found' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`api-v2 fixture listening on ${port}`)
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} received — shutting down`)
    server.close(() => process.exit(0))
    server.closeIdleConnections?.()
  })
}
