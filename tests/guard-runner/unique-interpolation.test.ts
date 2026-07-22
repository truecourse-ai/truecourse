import { describe, it, expect, afterEach } from 'vitest'
import { runGuard } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeScenario,
  scenario,
  apiScenario,
  specBinds,
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

describe('runGuard — the `${unique}` scenario variable', () => {
  it('interpolates `${unique}` in cli argv and stdin', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unique.yaml',
      scenario({
        id: 'uni-cli',
        binds: specBinds('cli/version'),
        steps: [
          // argv: an unknown command echoes back the token → proves argv substitution.
          { run: ['${unique}'], expect: { exit: 64, stderr: { matches: 'unknown command: [a-z0-9]{8,12}' } } },
          // stdin: `shout` uppercases stdin → proves stdin substitution.
          { run: ['shout'], stdin: '${unique}', expect: { exit: 0, stdout: { matches: '^[A-Z0-9]{8,12}$' } } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('interpolates `${unique}` in an api request path', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/unique.yaml',
      apiScenario({
        id: 'uni-api',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/echo/${unique}' },
            // The echo endpoint reflects the interpolated path — a bare `${unique}`
            // would have thrown UnknownVariableError; a token proves it was seeded.
            expect: { status: 200, json: { path: { matches: '^/echo/[a-z0-9]{8,12}$' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)
})
