/**
 * Auth end to end through `runGuard`: the per-scenario cookie jar,
 * `captureHeaders`, and the `fromRequest` credential source, all against the
 * fixture todos server's auth surface (`/login` + `/me`, `/redirect`,
 * `/auth/token` + `/whoami`).
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, computeRecipeFingerprint } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeScenario,
  apiScenario,
  specBinds,
  FIXTURE_API_SERVER,
  FIXTURE_API_SERVER_V2,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('api driver — the per-scenario cookie jar', () => {
  it('replays a login`s Set-Cookie onto later steps, and drops it without the login', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/session.yaml',
      apiScenario({
        id: 'session.ok',
        binds: specBinds('cli/version'),
        steps: [
          { request: { method: 'POST', path: '/login', json: { user: 'owner' } }, expect: { status: 200 } },
          { request: { method: 'GET', path: '/me' }, expect: { status: 200, json: { user: { equals: 'owner' } } } },
        ],
      }),
    )
    writeScenario(
      r,
      'api/anon.yaml',
      apiScenario({
        id: 'session.anon',
        binds: specBinds('cli/whoami'),
        steps: [{ request: { method: 'GET', path: '/me' }, expect: { status: 401 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 2, fail: 0, error: 0 })
  })

  it('isolates the jar across scenarios — a sibling`s login never authenticates', async () => {
    const r = repo()
    writeApiRecipe(r)
    // Runs first alphabetically and logs in; the second scenario must still be anonymous
    // (and it would not be: same server binary, but a fresh boot AND a fresh jar).
    writeScenario(
      r,
      'api/a-login.yaml',
      apiScenario({
        id: 'a.login',
        binds: specBinds('cli/version'),
        steps: [{ request: { method: 'POST', path: '/login' }, expect: { status: 200 } }],
      }),
    )
    writeScenario(
      r,
      'api/b-other.yaml',
      apiScenario({
        id: 'b.other',
        binds: specBinds('cli/whoami'),
        // Asserts 200: it must FAIL, proving no cookie leaked in.
        steps: [{ request: { method: 'GET', path: '/me' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 1 })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const other = res.latest.scenarios.find((s) => s.id === 'b.other')!
    expect(other.outcome).toBe('fail')
    expect(other.failure).toMatchObject({ expected: 'status 200', actual: 'status 401' })
  })

  it('an explicit Cookie header on a step wins over the jar', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/explicit.yaml',
      apiScenario({
        id: 'cookie.explicit',
        binds: specBinds('cli/version'),
        steps: [
          { request: { method: 'POST', path: '/login' }, expect: { status: 200 } },
          // The jar holds a VALID sid; this step overrides it with a bogus one.
          {
            request: { method: 'GET', path: '/me', headers: { Cookie: 'sid=not-a-session' } },
            expect: { status: 401 },
          },
          // The next step (no explicit header) is back on the jar's valid session.
          { request: { method: 'GET', path: '/me' }, expect: { status: 200 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })

  it('honors expiry — a Max-Age=0 cookie is never replayed', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/expired.yaml',
      apiScenario({
        id: 'cookie.expired',
        binds: specBinds('cli/version'),
        steps: [
          { request: { method: 'POST', path: '/login?ttl=0' }, expect: { status: 200 } },
          { request: { method: 'GET', path: '/me' }, expect: { status: 401 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })

  it('honors Path scoping — a cookie set for /admin is not sent to /me', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/scoped.yaml',
      apiScenario({
        id: 'cookie.scoped',
        binds: specBinds('cli/version'),
        steps: [
          { request: { method: 'POST', path: '/login?path=/admin' }, expect: { status: 200 } },
          { request: { method: 'GET', path: '/me' }, expect: { status: 401 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })
})

describe('api driver — captureHeaders', () => {
  it('captures a response header into ${var}, case-insensitively, and records it', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/header-capture.yaml',
      apiScenario({
        id: 'capture.header',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/login' },
            // The header is `x-service`; the scenario asks for `X-SERVICE`.
            captureHeaders: { svc: 'X-SERVICE' },
            expect: { status: 200 },
          },
          {
            request: { method: 'GET', path: '/echo', headers: { 'x-seen': '${svc}' } },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('pass')
    const invocation = JSON.parse(
      fs.readFileSync(path.join(r, s.evidencePath!, 'invocation.json'), 'utf-8'),
    )
    expect(invocation.steps[0].captured).toEqual({ svc: 'todos' })
    expect(invocation.steps[1].requestHeaders['x-seen']).toBe('${svc}')
  })

  it('captures the Location of a redirect (never followed)', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/location.yaml',
      apiScenario({
        id: 'capture.location',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/redirect' },
            captureHeaders: { next: 'location' },
            expect: { status: 302 },
          },
          // The captured redirect target is a real value later steps can use.
          {
            request: { method: 'GET', path: '/echo?next=${next}' },
            expect: { status: 200, json: { 'query.next': { equals: '/todos/1' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })

  it('a missing header fails the step like a missing body capture path', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/header-miss.yaml',
      apiScenario({
        id: 'capture.header.miss',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/health' },
            captureHeaders: { tok: 'x-auth-token' },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('fail')
    expect(s.failure).toMatchObject({
      step: 1,
      expected: 'capture "tok" from response header "x-auth-token"',
      actual: 'the response carries no such header',
    })
  })

  it('body and header captures share one ${var} namespace and one evidence record', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/both-captures.yaml',
      apiScenario({
        id: 'capture.both',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/login', json: { user: 'member' } },
            capture: { who: 'user' },
            captureHeaders: { tok: 'x-token' },
            expect: { status: 200 },
          },
          {
            request: { method: 'GET', path: '/echo?who=${who}', headers: { authorization: '${tok}' } },
            expect: { status: 200, json: { 'query.who': { equals: 'member' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('pass')
    const invocation = JSON.parse(
      fs.readFileSync(path.join(r, s.evidencePath!, 'invocation.json'), 'utf-8'),
    )
    expect(Object.keys(invocation.steps[0].captured).sort()).toEqual(['tok', 'who'])
  })
})

describe('api driver — the fromRequest credential source', () => {
  const bearer = {
    header: 'Authorization',
    fromRequest: {
      method: 'POST',
      path: '/auth/token',
      json: { user: 'owner' },
      capture: 'token',
      template: 'Bearer ${value}',
    },
  }

  it('mints a credential from a login request at run start and injects it into scenarios', async () => {
    const r = repo()
    writeApiRecipe(r, { credentials: { session: bearer } })
    writeScenario(
      r,
      'api/whoami.yaml',
      apiScenario({
        id: 'cred.fromrequest',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/whoami', headers: { Authorization: '{{cred:session}}' } },
            expect: { status: 200, json: { user: { equals: 'owner' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1, fail: 0, error: 0 })
  })

  it('captures from a response HEADER too (captureHeader)', async () => {
    const r = repo()
    writeApiRecipe(r, {
      credentials: {
        session: {
          header: 'Authorization',
          fromRequest: {
            method: 'POST',
            path: '/auth/token',
            json: { user: 'member' },
            captureHeader: 'X-Token',
            template: 'Bearer ${value}',
          },
        },
      },
    })
    writeScenario(
      r,
      'api/whoami-header.yaml',
      apiScenario({
        id: 'cred.fromheader',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/whoami', headers: { Authorization: '{{cred:session}}' } },
            expect: { status: 200, json: { user: { equals: 'member' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })

  it('the template is OPT-IN — without one the captured value is injected verbatim', async () => {
    const r = repo()
    writeApiRecipe(r, {
      credentials: {
        raw: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/auth/token', json: { user: 'owner' }, capture: 'token' },
        },
      },
    })
    writeScenario(
      r,
      'api/raw.yaml',
      apiScenario({
        id: 'cred.verbatim',
        binds: specBinds('cli/version'),
        steps: [
          // `/whoami-raw` accepts a BARE token; `/whoami` (Bearer-only) must reject it.
          {
            request: { method: 'GET', path: '/whoami-raw', headers: { Authorization: '{{cred:raw}}' } },
            expect: { status: 200, json: { user: { equals: 'owner' } } },
          },
          {
            request: { method: 'GET', path: '/whoami', headers: { Authorization: '{{cred:raw}}' } },
            expect: { status: 401 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })

  it('a capture miss stops the whole run as credential-request-failed', async () => {
    const r = repo()
    writeApiRecipe(r, {
      credentials: {
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/auth/token?omit=1', capture: 'token' },
        },
      },
    })
    writeScenario(
      r,
      'api/whoami.yaml',
      apiScenario({
        id: 'cred.miss',
        binds: specBinds('cli/version'),
        steps: [{ request: { method: 'GET', path: '/whoami' }, expect: { status: 401 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('credential-request-failed')
    if (res.status !== 'credential-request-failed') return
    expect(res.message).toContain('credential "session" (POST /auth/token?omit=1)')
    expect(res.message).toContain('nothing is at body path "token"')
  })

  it('a login path the server does not serve stops the run too (404 with no token)', async () => {
    const r = repo()
    writeApiRecipe(r, {
      credentials: {
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/auth/nope', capture: 'token' },
        },
      },
    })
    writeScenario(
      r,
      'api/whoami.yaml',
      apiScenario({
        id: 'cred.404',
        binds: specBinds('cli/version'),
        steps: [{ request: { method: 'GET', path: '/whoami' }, expect: { status: 401 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('credential-request-failed')
    if (res.status !== 'credential-request-failed') return
    expect(res.message).toContain('answered 404')
  })

  it('the minted value is redacted out of evidence like any other credential', async () => {
    const r = repo()
    writeApiRecipe(r, { credentials: { session: bearer } })
    writeScenario(
      r,
      'api/leak.yaml',
      apiScenario({
        id: 'cred.redacted',
        binds: specBinds('cli/version'),
        steps: [
          {
            // `/echo-auth` reflects the header into the body AND logs it to stderr.
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:session}}' } },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const dir = path.join(r, res.latest.scenarios[0].evidencePath!)
    const transcript = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf-8')
    const invocation = fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8')
    const stderr = fs.readFileSync(path.join(dir, 'server.stderr.txt'), 'utf-8')
    // The echoed header (transcript) and the logged one (server stderr) are both masked.
    expect(transcript).toContain('«cred:session»')
    expect(stderr).toContain('«cred:session»')
    // The fixture's token is a 32-char hex hmac; none of it survives anywhere.
    for (const text of [transcript, invocation, stderr]) {
      expect(text).not.toMatch(/Bearer [0-9a-f]{32}/)
    }
  })
})

describe('fromRequest across servers', () => {
  it('mints the credential against the server the login names, not the default one', async () => {
    const r = repo()
    // The token is minted by api-v2 (`v2:` salted, so the web fixture would answer a
    // DIFFERENT one) and then presented back to api-v2 — proof the login rode the
    // preflight of the server it named rather than the recipe's default.
    writeApiRecipe(r, {
      servers: {
        web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
        'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health' },
      },
      defaultServer: 'web',
      credentials: {
        v2session: {
          header: 'Authorization',
          servers: ['api-v2'],
          fromRequest: {
            method: 'POST',
            path: '/v2/auth/token',
            capture: 'token',
            template: 'Bearer ${value}',
            server: 'api-v2',
          },
        },
      },
    })
    writeScenario(
      r,
      'api/v2.yaml',
      apiScenario({
        id: 'v2.minted',
        server: 'api-v2',
        steps: [
          {
            request: { method: 'GET', path: '/v2/echo', headers: { Authorization: '{{cred:v2session}}' } },
            expect: { status: 200, json: { authorization: { matches: '^Bearer [0-9a-f]{32}$' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })
})

describe('fromRequest and the recipe fingerprint', () => {
  function writeRecipeWith(r: string, fromRequest: Record<string, unknown>): void {
    writeApiRecipe(r, { credentials: { session: { header: 'Authorization', fromRequest: fromRequest as never } } })
  }

  it('carries no secret to strip — a changed login path re-plans, a re-ordering does not', () => {
    const r = repo()
    writeRecipeWith(r, { method: 'POST', path: '/auth/token', capture: 'token' })
    const base = computeRecipeFingerprint(r)

    // Key order is canonicalized away.
    writeRecipeWith(r, { capture: 'token', path: '/auth/token', method: 'POST' })
    expect(computeRecipeFingerprint(r)).toBe(base)

    // The login endpoint is a capability: changing it re-keys authoring.
    writeRecipeWith(r, { method: 'POST', path: '/auth/session', capture: 'token' })
    expect(computeRecipeFingerprint(r)).not.toBe(base)

    // So does the shape of what it mints.
    writeRecipeWith(r, { method: 'POST', path: '/auth/token', capture: 'token', template: 'Bearer ${value}' })
    expect(computeRecipeFingerprint(r)).not.toBe(base)
  })
})
