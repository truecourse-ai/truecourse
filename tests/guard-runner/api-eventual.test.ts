/**
 * GET-expect polling — the api driver's answer to eventual consistency.
 *
 * A real app may ack a write before it is queryable (queued flushes). The
 * fixture's `/eventual` pair models that: `arm` acks immediately, the flag
 * reads back `ready` only 400ms later. An idempotent read whose expectation
 * does not hold yet is re-issued until it holds or the step budget runs out;
 * mutating methods are never replayed.
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

describe('api GET expects poll until the state lands', () => {
  it('a read issued right after the ack converges to green instead of failing on the race', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/eventual.yaml',
      apiScenario({
        id: 'api-eventual',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/eventual/arm' },
            expect: { status: 200, json: { armed: { equals: true } } },
          },
          {
            // 0ms after the ack this reads `ready: false`; the poll carries it
            // across the 400ms flush window.
            request: { method: 'GET', path: '/eventual' },
            expect: { status: 200, json: { ready: { equals: true } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios.find((s) => s.id === 'api-eventual')!
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')
  })
})
