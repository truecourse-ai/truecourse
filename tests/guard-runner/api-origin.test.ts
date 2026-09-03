/**
 * The api executor's default `Origin` header.
 *
 * Node's fetch stamps browser-shaped `Sec-Fetch-*` headers on every request, so
 * origin-checking middleware (better-auth CSRF protection, for one) reads a bare
 * request as a browser call and refuses state-changing paths that carry no
 * `Origin`. The executor therefore defaults `Origin` to the server's own origin;
 * a step that writes its OWN `Origin` header wins (explicit beats implicit).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('api requests carry an Origin header by default', () => {
  it('defaults Origin to the server origin; an explicit step Origin wins', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/origin.yaml',
      apiScenario({
        id: 'api-origin',
        binds: specBinds('cli/version'),
        steps: [
          {
            // No Origin authored — the executor fills the server's own origin in.
            request: { method: 'GET', path: '/echo' },
            expect: { status: 200, json: { origin: { contains: 'http://127.0.0.1' } } },
          },
          {
            // An authored Origin is never overwritten.
            request: { method: 'GET', path: '/echo', headers: { Origin: 'https://example.test' } },
            expect: { status: 200, json: { origin: { equals: 'https://example.test' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios.find((s) => s.id === 'api-origin')!
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')
  })
})
