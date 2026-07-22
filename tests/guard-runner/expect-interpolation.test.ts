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

/** Run one scenario and return its result (asserting the run itself was ok). */
async function runOne(r: string) {
  const res = await runGuard({ repoRoot: r, skipBuild: true })
  expect(res.status).toBe('ok')
  if (res.status !== 'ok') throw new Error('run not ok')
  return res.latest.scenarios[0]
}

describe('expectation interpolation — the assertion side (api)', () => {
  it('interpolates `${unique}` in an api json-equals expectation', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/uniq-expect.yaml',
      apiScenario({
        id: 'uniq-expect',
        binds: specBinds('a/b'),
        // Both request AND expectation carry `${unique}`; they must resolve to the
        // SAME token so the assertion holds (a raw-literal expected would never match).
        steps: [{ request: { method: 'GET', path: '/echo/${unique}' }, expect: { status: 200, json: { path: { equals: '/echo/${unique}' } } } }],
      }),
    )
    expect((await runOne(r)).outcome).toBe('pass')
  }, 60_000)

  it('interpolates `{{fixture:<name>.<field>}}` in an api expectation (the bench false-positive shape)', async () => {
    const r = repo()
    writeApiRecipe(r, {
      env: { SEED_MANIFEST: JSON.stringify({ fixtures: { user: { id: 4, username: 'pro' } } }) },
      seed: { provides: { fixtures: { user: ['id', 'username'] } } },
    })
    writeScenario(
      r,
      'api/fixture-expect.yaml',
      apiScenario({
        id: 'fixture-expect',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/echo/{{fixture:user.id}}?u={{fixture:user.username}}' },
            // The doc asserts the reflected values equal the seeded fixture — the
            // expectation template must be substituted, not compared literally.
            expect: { status: 200, json: { path: { contains: '{{fixture:user.id}}' }, 'query.u': { equals: '{{fixture:user.username}}' } } },
          },
        ],
      }),
    )
    expect((await runOne(r)).outcome).toBe('pass')
  }, 60_000)

  it('interpolates a `${var}` captured earlier when it appears in a LATER step\'s expectation (pre-existing bug)', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/capture-expect.yaml',
      apiScenario({
        id: 'capture-expect',
        binds: specBinds('a/b'),
        steps: [
          { request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } }, capture: { todoId: 'id', t: 'title' }, expect: { status: 201 } },
          // `${t}` in the expectation must resolve to the captured "buy milk".
          { request: { method: 'GET', path: '/todos/${todoId}' }, expect: { status: 200, json: { title: { equals: '${t}' } } } },
        ],
      }),
    )
    expect((await runOne(r)).outcome).toBe('pass')
  }, 60_000)

  it('leaves `{{cred:<name>}}` LITERAL in an expectation (secrets stay header-only) → loud mismatch', async () => {
    const r = repo()
    writeApiRecipe(r, { credentials: { 'api-key': { header: 'Authorization', value: 'sk-secret-xyz' } } })
    writeScenario(
      r,
      'api/cred-expect.yaml',
      apiScenario({
        id: 'cred-expect',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:api-key}}' } },
            // The request substitutes the secret, but the expectation must NOT — it
            // stays the literal placeholder, so it mismatches the real reflected value.
            expect: { status: 200, json: { authorization: { equals: '{{cred:api-key}}' } } },
          },
        ],
      }),
    )
    const result = await runOne(r)
    expect(result.outcome).toBe('fail')
    // The expected side shows the un-substituted placeholder (never the secret).
    expect(result.failure!.expected).toContain('{{cred:api-key}}')
  }, 60_000)
})

describe('expectation interpolation — the assertion side (cli)', () => {
  it('interpolates `${unique}` in a cli stream expectation', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/uniq-expect.yaml',
      scenario({
        id: 'cli-uniq-expect',
        binds: specBinds('cli/version'),
        // The unknown-command echo carries the token; the expectation names it via
        // `${unique}` and must resolve to the same token before comparison.
        steps: [{ run: ['${unique}'], expect: { exit: 64, stderr: { contains: 'unknown command: ${unique}' } } }],
      }),
    )
    expect((await runOne(r)).outcome).toBe('pass')
  }, 60_000)
})
