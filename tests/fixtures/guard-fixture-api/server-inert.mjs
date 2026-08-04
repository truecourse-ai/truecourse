#!/usr/bin/env node
/**
 * Fixture HTTP server for the no-op anomaly tests (C4): the DEAD-STUB failure
 * class — a server that boots, answers its health check, and then serves no
 * route at all. Every request outside /health gets the same empty 404,
 * regardless of method or path: exactly what a placeholder server (or a recipe
 * that boots the wrong service) looks like, and exactly what the anomaly gate
 * exists to catch after the boot preflight has honestly passed.
 *
 * Honors the runner contract: listens on `PORT` (required).
 */

import http from 'node:http'

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('PORT env var is required')
  process.exit(1)
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.split('?')[0] === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  // The dead-stub answer: one uniform status, no body, for everything.
  res.writeHead(404)
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`inert fixture listening on ${port}`)
})
