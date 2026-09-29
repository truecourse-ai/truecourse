#!/usr/bin/env node
/**
 * Fixture HTTP API for the seed-drafting tests — dependency-free
 * `node:http`. Its "database" is ONE JSON file whose absolute path arrives in
 * `SEED_STORE`, exactly the way a real app reads `DATABASE_URL`: the seed script and
 * the server therefore talk to the same store even though the server boots in a
 * throwaway sandbox cwd (which is why the path must be absolute, not `./store.json`).
 *
 * Surface:
 *   GET /health → 200 {"ok":true}
 *   GET /orgs   → 200 {"orgs":[…]} (empty when nothing has been seeded)
 *   GET /me     → 200 when the Authorization header matches a seeded token
 *                 (store `tokens` array, matched VERBATIM), else 401 — the
 *                 auth-gated route the credential probes prove against
 *   GET /boom   → 500
 *
 * It doubles as the WEB surface (a recipe `web` block may serve the same file):
 *   GET /signin    → 200 html — the login page, always public
 *   GET /dashboard → 200 html when the Cookie header matches a seeded session
 *                    (store `sessions` array, matched VERBATIM), else a 302
 *                    redirect to /signin — the signed-in page the web
 *                    credential probes prove an authenticated load of
 *   POST /api/login        → 200 when the JSON body's email+password match a
 *                            seeded user (store `users`), else 401 — the JSON
 *                            login endpoint the web login probe proves
 *   POST /api/login-always → 200 whatever the body says — the endpoint that
 *                            gates nothing, which a login probe must refuse
 *   GET  /api/csrf         → 200 { csrfToken } + a `csrf` cookie carrying the
 *                            same value — the double-submit mint route
 *   POST /api/login-csrf   → /api/login, but first requires body.csrfToken to
 *                            match the `csrf` cookie (500 otherwise) — the
 *                            documenso-shaped login the csrf two-step proves
 * Login and CSRF routes require the server's own Origin, as browser-facing
 * auth middleware does. /api/login-refused reports a structured rejection
 * with echoed secrets to exercise diagnostic redaction.
 * /spa-dashboard returns the same shell for everyone. Its router fetches
 * /api/browser-session, then redirects anonymous users to /spa-login and
 * signed-in users to /spa-dashboard/home. /spa-broken has a failing router.
 * /admin is the same router with its login NESTED under the route, at
 * /admin/login. /busy-dashboard routes correctly while it polls without end
 * and raises an unrelated page error. /api/login-refused?shape=nested wraps
 * its error in an `error` envelope. /hash-app keeps its routes in the
 * fragment (#/dashboard, #/login). /racy-dashboard turns a signed-in user
 * away on the first loads of a boot, as a guard racing its own data does.
 * /slow-dashboard decides only after a session request that takes 4s.
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

let racyLoads = 0

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/health') return json(200, { ok: true })
    if (url.pathname === '/orgs') return json(200, { orgs: read().orgs ?? [] })
    if (url.pathname === '/me') {
      const auth = req.headers.authorization ?? ''
      if ((read().tokens ?? []).includes(auth)) return json(200, { me: 'guard' })
      return json(401, { error: 'unauthorized' })
    }
    if (url.pathname === '/boom') return json(500, { error: 'kaboom' })
    if (url.pathname === '/api/browser-session') {
      const answer = () => json(200, { signedIn: (read().sessions ?? []).includes(req.headers.cookie ?? '') })
      return url.searchParams.has('slow') ? void setTimeout(answer, 4000) : answer()
    }
    if (url.pathname === '/slow-dashboard') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(`<html><body>Dashboard<script>
        setTimeout(() => fetch('/api/browser-session?slow').then(r => r.json()).then(session => {
          if (!session.signedIn) location.replace('/spa-login');
        }), 3500);
      </script></body></html>`)
    }
    if (url.pathname === '/spa-dashboard' || url.pathname === '/spa-dashboard/home') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(`<html><body><div id="app">Loading</div><script>
        fetch('/api/browser-session').then(r => r.json()).then(session => {
          if (!session.signedIn) { location.replace('/spa-login'); return; }
          history.replaceState(null, '', '/spa-dashboard/home');
          document.getElementById('app').textContent = 'Private dashboard';
        });
      </script></body></html>`)
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/home' || url.pathname === '/busy-dashboard') {
      const busy = url.pathname === '/busy-dashboard'
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(`<html><body><div id="app">Loading</div><script>
        fetch('/api/browser-session').then(r => r.json()).then(session => {
          // A session that is present but not accepted is told why, in the
          // query: the same login page an anonymous visitor lands on.
          if (!session.signedIn) { location.replace('${busy ? '/spa-login' : '/admin/login'}${req.headers.cookie ? '?error=SessionExpired' : ''}'); return; }
          ${busy ? '' : "history.replaceState(null, '', '/admin/home');"}
          document.getElementById('app').textContent = 'Private';
        });
        ${busy ? "setInterval(() => fetch('/health'), 100); setTimeout(() => { throw new Error('unrelated widget failure') }, 0);" : ''}
      </script></body></html>`)
    }
    if (url.pathname === '/hash-app') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(`<html><body><div id="app">Loading</div><script>
        const route = () => fetch('/api/browser-session').then(r => r.json()).then(session => {
          if (location.hash.startsWith('#/dashboard') && !session.signedIn) location.hash = '#/login';
          document.getElementById('app').textContent = location.hash;
        });
        addEventListener('hashchange', route);
        route();
      </script></body></html>`)
    }
    if (url.pathname === '/racy-dashboard') {
      // The HTTP proof's credentialed request is the first load, the
      // browser's first the second: both are turned away.
      const signedIn = (read().sessions ?? []).includes(req.headers.cookie ?? '')
      const turnedAway = !signedIn || ++racyLoads <= 2
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(`<html><body>Dashboard<script>
        if (${turnedAway}) location.replace('/spa-login');
      </script></body></html>`)
    }
    if (url.pathname === '/admin/login') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<html><body><form>Sign in</form></body></html>')
    }
    if (url.pathname === '/spa-login') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<html><body><form>Sign in</form></body></html>')
    }
    if (url.pathname === '/spa-broken') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<html><body>Loading<script>throw new Error("broken router")</script></body></html>')
    }
    if (url.pathname === '/api/login-refused' && req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        const body = JSON.parse(raw)
        const status = Number(url.searchParams.get('status'))
        const code = { 403: 'INVALID_ORIGIN', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR' }[status]
        const message = `Request refused for ${body.email}: ${body.password}; ${read().sessions[0]}`
        if (url.searchParams.get('shape') === 'nested') return json(status, { error: { code, message } })
        json(status, { code, message, token: 'unpublished-response-token', request: body })
      })
      return
    }
    if (['/api/login', '/api/login-csrf', '/api/csrf'].includes(url.pathname)) {
      const origin = req.headers.origin
      if (!origin) return json(403, { code: 'MISSING_OR_NULL_ORIGIN', message: 'Missing or null Origin' })
      if (origin !== `http://127.0.0.1:${port}`) return json(403, { code: 'INVALID_ORIGIN', message: 'Invalid origin' })
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        let body = {}
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          /* an unparseable body matches no user */
        }
        const match = (read().users ?? []).some(
          (u) => u.email === body.email && u.password === body.password,
        )
        if (match) {
          res.setHeader('set-cookie', `${read().sessions[0]}; Path=/; HttpOnly`)
          return json(200, { ok: true })
        }
        return json(401, { error: 'invalid credentials' })
      })
      return
    }
    if (url.pathname === '/api/login-always' && req.method === 'POST') {
      req.on('data', () => {})
      req.on('end', () => json(200, { ok: true }))
      return
    }
    if (url.pathname === '/api/csrf') {
      const token = Math.random().toString(36).slice(2)
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `csrf=${token}; Path=/; HttpOnly`,
      })
      return res.end(JSON.stringify({ csrfToken: token }))
    }
    if (url.pathname === '/api/login-csrf' && req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        let body = {}
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          /* an unparseable body matches no user */
        }
        const cookieToken = /(?:^|;\s*)csrf=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
        if (!cookieToken || body.csrfToken !== cookieToken) return json(500, { error: 'invalid csrf token' })
        const match = (read().users ?? []).some(
          (u) => u.email === body.email && u.password === body.password,
        )
        if (match) return json(200, { ok: true })
        return json(401, { error: 'invalid credentials' })
      })
      return
    }
    if (url.pathname === '/signin') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<form>sign in</form>')
    }
    if (url.pathname === '/dashboard') {
      if ((read().sessions ?? []).includes(req.headers.cookie ?? '')) {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<h1>dashboard</h1>')
      }
      res.writeHead(302, { location: '/signin' })
      return res.end()
    }
    if (url.pathname === '/dashboard-500') {
      // The documenso idiom: a gated page that answers an anonymous request
      // with HTTP 500 (an error body), not 401/403 or a login redirect.
      if ((read().sessions ?? []).includes(req.headers.cookie ?? '')) {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<h1>dashboard</h1>')
      }
      return json(500, { code: 'UNAUTHORIZED' })
    }
    json(404, { error: 'not found' })
  })
  .listen(port)
