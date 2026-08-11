#!/usr/bin/env node
/**
 * Fixture WEB app for the guard web-driver tests — dependency-free `node:http`,
 * two linked pages, no build step and no client framework. Deliberately NOT the
 * real dashboard: the web-driver unit suite must be hermetic and fast, and the
 * real dashboard is exercised by the separate end-to-end proof.
 *
 * Honors the same runner contract the api fixture does: it listens on `PORT` and
 * reads its state from the CWD it was started in — which is the guard sandbox — so
 * a CLI step earlier in the same scenario can produce what the browser then sees.
 *
 * Surface (every interactive element carries a role AND an accessible name, which
 * is the whole locator vocabulary a web step may use):
 *   GET /health   → 200 text/plain "ok" (the readiness probe)
 *   GET /         → heading "Guard Web Fixture"
 *                   link "Notes" → /notes
 *                   button "Reveal" → replaces the status paragraph's text with
 *                                     "the secret is out" (no navigation)
 *                   textbox "Title" + button "Save" → /notes?title=<value>
 *   GET /notes    → heading "Notes"
 *                   the contents of `notes.txt` in the CWD, or "no notes yet"
 *                   "title: <t>" when ?title= is present
 *                   link "Home" → /
 *   GET /slow-text → heading "Slow"; a paragraph whose text only becomes
 *                   "ready at last" after TC_WEB_DELAY_MS (default 400) — the
 *                   readiness-waiting case: an expectation must WAIT for
 *                   observable state instead of sleeping or racing.
 *
 * `TC_WEB_PIDFILE`, when set, is written with this process's pid at listen time —
 * the teardown tests read it back to prove nothing outlived the scenario.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('guard-fixture-web needs a PORT')
  process.exit(1)
}

const delayMs = Number(process.env.TC_WEB_DELAY_MS ?? 400)

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
${body}
</body>
</html>
`
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const HOME = page(
  'Guard Web Fixture',
  `<h1>Guard Web Fixture</h1>
<p id="status">nothing revealed yet</p>
<button type="button" onclick="document.getElementById('status').textContent = 'the secret is out'">Reveal</button>
<p><a href="/notes">Notes</a></p>
<form onsubmit="event.preventDefault(); location.href = '/notes?title=' + encodeURIComponent(document.getElementById('title').value)">
  <label for="title">Title</label>
  <input id="title" name="title" type="text">
  <button type="submit">Save</button>
</form>`,
)

const SLOW = page(
  'Slow',
  `<h1>Slow</h1>
<p id="slow">still working</p>
<script>setTimeout(function () { document.getElementById('slow').textContent = 'ready at last' }, ${delayMs})</script>`,
)

function notesPage(url) {
  const notesFile = path.resolve(process.cwd(), 'notes.txt')
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf-8').trim() : ''
  const title = url.searchParams.get('title')
  return page(
    'Notes',
    `<h1>Notes</h1>
${title === null ? '' : `<p>title: ${escapeHtml(title)}</p>\n`}<p id="notes">${notes === '' ? 'no notes yet' : escapeHtml(notes)}</p>
<p><a href="/">Home</a></p>`,
  )
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  const html =
    url.pathname === '/'
      ? HOME
      : url.pathname === '/notes'
        ? notesPage(url)
        : url.pathname === '/slow-text'
          ? SLOW
          : null
  if (html === null) {
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end(page('Not found', '<h1>Not found</h1>'))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(html)
})

server.listen(port, '127.0.0.1', () => {
  if (process.env.TC_WEB_PIDFILE) {
    fs.writeFileSync(process.env.TC_WEB_PIDFILE, String(process.pid))
  }
  process.stdout.write(`guard-fixture-web listening on ${port}\n`)
})
