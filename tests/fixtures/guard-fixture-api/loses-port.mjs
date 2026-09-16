#!/usr/bin/env node
// Fixture server that LOSES ITS PORT on the first boot.
//
// A port is handed to a child as a bare number, free to anyone until the child
// binds it. This fixture plays the boot that lost that race: on its first run it
// gives the number to a detached squatter (another process on the box, as far
// as the runner can tell) and dies in `listen`, exactly as a real server does
// with EADDRINUSE. Every boot appends to `boots.log`, so a test can say how many
// there were; `TC_NO_SQUAT` is the same death with the port left FREE, which is
// an ordinary crash and must not be tried again.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'

const port = Number(process.env.PORT)
const marker = path.join(process.cwd(), 'lost-port.marker')
const bound = path.join(process.cwd(), 'squatter-bound.marker')
fs.appendFileSync(path.join(process.cwd(), 'boots.log'), `${port}\n`)

if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, String(port))
  if (!process.env.TC_NO_SQUAT) {
    // Holds the port well past the boot that follows, then goes on its own so no
    // test leaves a listener behind.
    spawn(
      process.execPath,
      [
        '-e',
        `const net = require('node:net'), fs = require('node:fs')
         const srv = net.createServer()
         srv.listen(${port}, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(bound)}, 'bound'))
         setTimeout(() => process.exit(0), 20000)`,
      ],
      { detached: true, stdio: 'ignore' },
    ).unref()
    // The port must be GONE before this process is, or the runner would look at
    // a free port and read the death as the crash it is not.
    const deadline = Date.now() + 10_000
    while (!fs.existsSync(bound) && Date.now() < deadline) {}
  }
  console.error(`fatal: listen EADDRINUSE 127.0.0.1:${port}`)
  process.exit(1)
}

http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    res.writeHead(404)
    res.end()
  })
  .listen(port, '127.0.0.1', () => console.log(`loses-port fixture listening on ${port}`))
