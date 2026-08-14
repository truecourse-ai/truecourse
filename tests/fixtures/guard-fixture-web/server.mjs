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
 *   GET /controls → heading "Controls"; the surface the OBSERVATION channels need,
 *                   because none of it can be seen in visible text:
 *                     - tab "Home" / tab "Flows" in a tablist, `aria-selected`
 *                       moving between them on click (the active-tab case);
 *                     - switch "LLM rules", `aria-checked` flipping on click;
 *                     - button "Filters", `aria-expanded` flipping on click;
 *                     - button "Publish", natively `disabled`;
 *                     - button "Detection mode", whose selected position is marked
 *                       by a CLASS and a colour and by no ARIA state at all — the
 *                       element a state assertion must fail honestly on;
 *                     - button "Toggle theme", which puts the `dark` class on the
 *                       DOCUMENT ELEMENT and writes `data-theme` beside it (dark
 *                       mode lives nowhere else — not in text, not in a name);
 *                     - icon buttons "Fit view" / "Zoom in" / "Zoom out", whose
 *                       accessible names are `aria-label`s that never appear in the
 *                       page's text (the several-targets case);
 *                     - button "Add filter", which pushes `?filter=on` WITHOUT a
 *                       document navigation and re-renders on `popstate` — so a
 *                       browser Back is observable in a single-page app too.
 *   GET /capture  → heading "Capture"; the surface the WIDENED LOCATOR family and
 *                   the web CAPTURE getters need — every element here is addressed
 *                   by a handle a USER perceives, and every getter has something
 *                   real to read:
 *                     - textbox labelled "Note", placeholder "Search notes",
 *                       carrying the VALUE `draft-42` (the value getter reads a
 *                       DOM property no page text ever shows);
 *                     - paragraph "seats left: 3", which button "Book a seat"
 *                       decrements — the delta claim's subject;
 *                     - three listitems inside a list (the count getter);
 *                     - link "Permalink" whose `href` is `/notes?id=7`;
 *                     - switch "Email alerts", `aria-checked="true"`;
 *                     - image with alt text "Company logo";
 *                     - button with the title "Close the panel";
 *                     - paragraph "row two of three" (the plain-text handle).
 *   GET /upload   → heading "Upload"; the surface the `upload` verb needs — a
 *                   visible labelled file input, a hidden one behind a button (the
 *                   react-dropzone shape), an `accept=".pdf"` one that refuses
 *                   anything else in the app's own words, and a button that opens
 *                   no chooser at all. Every picked file is reported back with the
 *                   name, the size, the type and its first bytes.
 *
 * The JSON surface — the SAME state the pages render, read as structured data, which
 * is what a `request` step is for: drive the UI, then ask the app what actually
 * happened instead of regexing the page for it.
 *
 *   GET  /api/notes      → { notes: [<line>…], total: <n> } from `notes.txt` in the
 *                          CWD; `?q=` keeps only the lines containing it (the
 *                          structured analog of the pages' filter)
 *   POST /api/notes      → { id, line } — appends `{ "line": "…" }` to `notes.txt`
 *                          (201), so a request step can also ACT and hand the id it
 *                          minted to the steps after it
 *   GET  /api/notes/:id  → { id, line } (404 with `{ "error": … }` past the end)
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

/**
 * The page whose whole state is INVISIBLE: ARIA states, a class on the document
 * element, accessible names that are `aria-label`s, and a single-page history
 * entry. Nothing here can be asserted with page text, which is the point.
 */
const CONTROLS = page(
  'Controls',
  `<h1>Controls</h1>
<div role="tablist">
  <button type="button" role="tab" id="tab-home" aria-selected="true">Home</button>
  <button type="button" role="tab" id="tab-flows" aria-selected="false">Flows</button>
</div>
<button type="button" role="switch" id="llm" aria-checked="false">LLM rules</button>
<button type="button" id="filters" aria-expanded="false">Filters</button>
<button type="button" id="publish" disabled>Publish</button>
<button type="button" id="detection" class="mode-committed">Detection mode</button>
<button type="button" id="theme" aria-label="Toggle theme">◐</button>
<button type="button" aria-label="Fit view">⤢</button>
<button type="button" aria-label="Zoom in">+</button>
<button type="button" aria-label="Zoom out">−</button>
<button type="button" id="add-filter">Add filter</button>
<p id="mode">filter: off</p>
<script>
function flip(el, attr) { el.setAttribute(attr, el.getAttribute(attr) === 'true' ? 'false' : 'true') }
document.getElementById('llm').onclick = function () { flip(this, 'aria-checked') }
document.getElementById('filters').onclick = function () { flip(this, 'aria-expanded') }
for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.onclick = function () {
    for (const other of document.querySelectorAll('[role=tab]')) other.setAttribute('aria-selected', String(other === this))
  }
}
// The detection switch moves by COLOUR and a class — no ARIA state anywhere.
document.getElementById('detection').onclick = function () {
  this.className = this.className === 'mode-committed' ? 'mode-working' : 'mode-committed'
}
document.getElementById('theme').onclick = function () {
  const root = document.documentElement
  const dark = root.classList.toggle('dark')
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
}
function renderMode() {
  document.getElementById('mode').textContent =
    new URL(location.href).searchParams.get('filter') === 'on' ? 'filter: on' : 'filter: off'
}
document.getElementById('add-filter').onclick = function () {
  history.pushState({}, '', '/controls?filter=on')
  renderMode()
}
window.addEventListener('popstate', renderMode)
renderMode()
</script>`,
)

/**
 * The page every LOCATOR MEMBER and every CAPTURE GETTER has something real to
 * read on. Nothing here is addressed by a class or an id from a scenario's side:
 * a placeholder, a label, an alt text, a title and plain visible text are all
 * things a person sees, which is the whole membership rule of the locator family.
 */
const CAPTURE = page(
  'Capture',
  `<h1>Capture</h1>
<p id="seats">seats left: 3</p>
<button type="button" id="book">Book a seat</button>
<label for="note">Note</label>
<input id="note" placeholder="Search notes" value="draft-42">
<p>row two of three</p>
<ul>
  <li>alpha</li>
  <li>beta</li>
  <li>gamma</li>
</ul>
<p><a id="perma" href="/notes?id=7">Permalink</a></p>
<button type="button" role="switch" id="alerts" aria-checked="true">Email alerts</button>
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Company logo" width="16" height="16">
<button type="button" id="close" title="Close the panel">×</button>
<script>
document.getElementById('book').onclick = function () {
  const seats = document.getElementById('seats')
  const left = Number(/seats left: (\\d+)/.exec(seats.textContent)[1])
  seats.textContent = 'seats left: ' + Math.max(0, left - 1)
}
</script>`,
)

/**
 * The page a file is handed to, carrying BOTH shapes a real app has:
 *   - a labelled, VISIBLE `input[type=file]` ("Attachment") — the plain case;
 *   - a `button` "Choose a file" whose click forwards to a `display:none` input,
 *     which is the react-dropzone shape every styled "Upload Document" control in
 *     the wild is (the input has no role and no accessible name, so the locator
 *     vocabulary can only ever address the button);
 *   - a labelled `accept=".pdf"` input ("PDF only") that REFUSES anything else in
 *     the app's own words — the effect an `expect` block judges, never the step;
 *   - a button "Not an upload" that opens no chooser at all, which is the failure
 *     a `setInputFiles` shortcut on a hidden input would have hidden.
 *
 * Whichever input received the file, the page reports what it ACTUALLY got —
 * `<source>: <name> · <n> bytes · <type> · <first bytes>` — so no test can pass on
 * a chooser that opened and took nothing, and binary payloads (reported as hex)
 * prove the bytes were never round-tripped through UTF-8.
 */
const UPLOAD = page(
  'Upload',
  `<h1>Upload</h1>
<p><label for="visible-file">Attachment</label>
<input id="visible-file" type="file"></p>
<p><button type="button" id="pick">Choose a file</button>
<input id="hidden-file" type="file" style="display:none"></p>
<p><label for="pdf-file">PDF only</label>
<input id="pdf-file" type="file" accept=".pdf"></p>
<p><button type="button" id="inert">Not an upload</button></p>
<p id="picked">nothing picked yet</p>
<script>
function firstBytes(buffer) {
  const head = new Uint8Array(buffer).slice(0, 12)
  const readable = Array.from(head).every(function (b) { return b >= 9 && b < 128 })
  if (readable) return new TextDecoder().decode(head).replace(/[\\r\\n\\t]/g, ' ')
  return 'hex:' + Array.from(new Uint8Array(buffer).slice(0, 8))
    .map(function (b) { return b.toString(16).padStart(2, '0') })
    .join('')
}
function report(source, input) {
  const picked = document.getElementById('picked')
  const file = input.files[0]
  if (!file) { picked.textContent = source + ': nothing picked'; return }
  if (input.id === 'pdf-file' && !/\\.pdf$/i.test(file.name)) {
    picked.textContent = 'rejected: ' + file.name + ' is not a .pdf'
    return
  }
  file.arrayBuffer().then(function (buffer) {
    picked.textContent =
      source + ': ' + file.name + ' · ' + file.size + ' bytes · ' +
      (file.type || 'no type') + ' · ' + firstBytes(buffer)
  })
}
document.getElementById('visible-file').onchange = function () { report('visible', this) }
document.getElementById('hidden-file').onchange = function () { report('hidden', this) }
document.getElementById('pdf-file').onchange = function () { report('pdf', this) }
document.getElementById('pick').onclick = function () { document.getElementById('hidden-file').click() }
// Found, clickable, and behind it nothing asks for a file.
document.getElementById('inert').onclick = function () {
  document.getElementById('picked').textContent = 'clicked, and no file was asked for'
}
</script>`,
)

/** The one piece of state this app has: the lines of `notes.txt` in the CWD. */
function noteLines() {
  const notesFile = path.resolve(process.cwd(), 'notes.txt')
  if (!fs.existsSync(notesFile)) return []
  return fs
    .readFileSync(notesFile, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function appendNote(line) {
  const notesFile = path.resolve(process.cwd(), 'notes.txt')
  fs.appendFileSync(notesFile, `${line}\n`)
  return noteLines().length - 1
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => resolve(raw))
  })
}

/** The JSON surface: the same notes, as data. Returns true when it handled the request. */
async function serveApi(req, res, url) {
  if (url.pathname === '/api/notes' && req.method === 'GET') {
    const q = url.searchParams.get('q')
    const notes = noteLines().filter((line) => q === null || line.includes(q))
    sendJson(res, 200, { notes, total: notes.length, ...(q === null ? {} : { filter: q }) })
    return true
  }
  if (url.pathname === '/api/notes' && req.method === 'POST') {
    const raw = await readBody(req)
    let line
    try {
      line = JSON.parse(raw).line
    } catch {
      line = undefined
    }
    if (typeof line !== 'string' || line.length === 0) {
      sendJson(res, 400, { error: 'a note needs a non-empty `line`' })
      return true
    }
    sendJson(res, 201, { id: appendNote(line), line })
    return true
  }
  const one = /^\/api\/notes\/(\d+)$/.exec(url.pathname)
  if (one && req.method === 'GET') {
    const id = Number(one[1])
    const lines = noteLines()
    if (id >= lines.length) {
      sendJson(res, 404, { error: `no note ${id}` })
      return true
    }
    sendJson(res, 200, { id, line: lines[id] })
    return true
  }
  return false
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  if (url.pathname.startsWith('/api/')) {
    if (await serveApi(req, res, url)) return
    sendJson(res, 404, { error: `no route ${req.method} ${url.pathname}` })
    return
  }
  const html =
    url.pathname === '/'
      ? HOME
      : url.pathname === '/notes'
        ? notesPage(url)
        : url.pathname === '/slow-text'
          ? SLOW
          : url.pathname === '/controls'
            ? CONTROLS
            : url.pathname === '/capture'
              ? CAPTURE
              : url.pathname === '/upload'
                ? UPLOAD
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
