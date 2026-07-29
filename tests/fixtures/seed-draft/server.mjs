#!/usr/bin/env node
/**
 * Fixture HTTP API for the seed-drafting tests (item 66) — dependency-free
 * `node:http`. Its "database" is ONE JSON file whose absolute path arrives in
 * `SEED_STORE`, exactly the way a real app reads `DATABASE_URL`: the seed script and
 * the server therefore talk to the same store even though the server boots in a
 * throwaway sandbox cwd (which is why the path must be absolute, not `./store.json`).
 *
 * Surface:
 *   GET /health → 200 {"ok":true}
 *   GET /orgs   → 200 {"orgs":[…]} (empty when nothing has been seeded)
 *   GET /boom   → 500
 */

import http from 'node:http'
import fs from 'node:fs'

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('PORT env var is required')
  process.exit(1)
}
const store = process.env.SEED_STORE
if (!store) {
  console.error('SEED_STORE env var is required')
  process.exit(1)
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(store, 'utf-8'))
  } catch {
    return { orgs: [] }
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/health') return json(200, { ok: true })
    if (url.pathname === '/orgs') return json(200, { orgs: read().orgs ?? [] })
    if (url.pathname === '/boom') return json(500, { error: 'kaboom' })
    json(404, { error: 'not found' })
  })
  .listen(port)
