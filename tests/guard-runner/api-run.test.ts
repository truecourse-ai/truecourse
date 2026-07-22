import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import { GuardLatestSchema } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeRecipe,
  writeScenario,
  scenario,
  apiScenario,
  specBinds,
  FIXTURE_BIN,
  FIXTURE_API_SERVER,
  FIXTURE_API_CRASH,
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

describe('runGuard — api driver end to end', () => {
  it('runs api scenarios (capture, chaining, json expects) and writes evidence', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/create-fetch.yaml',
      apiScenario({
        id: 'create-fetch',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } },
            capture: { todoId: 'id' },
            expect: {
              status: 201,
              headers: { 'x-service': { equals: 'todos' } },
              json: { title: { equals: 'buy milk' }, done: { equals: false } },
            },
          },
          {
            request: { method: 'GET', path: '/todos/${todoId}' },
            expect: { status: 200, json: { title: { equals: 'buy milk' } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/missing.yaml',
      apiScenario({
        id: 'missing-404',
        binds: specBinds('cli/whoami'),
        steps: [
          {
            request: { method: 'GET', path: '/todos/999' },
            expect: { status: 404, json: { error: { equals: 'todo not found' } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/drift.yaml',
      apiScenario({
        id: 'drift.fail',
        binds: specBinds('cli/boom'),
        steps: [
          {
            request: { method: 'GET', path: '/boom' },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return

    expect(() => GuardLatestSchema.parse(res.latest)).not.toThrow()
    expect(res.latest.summary).toMatchObject({ total: 3, pass: 2, fail: 1, error: 0 })

    const drift = res.latest.scenarios.find((s) => s.id === 'drift.fail')!
    expect(drift.outcome).toBe('fail')
    expect(drift.failure).toMatchObject({ step: 1, expected: 'status 200', actual: 'status 500' })
    // The response body rides the failure's stdout excerpt; the server's stderr
    // (where the 500 logged its line) rides the stderr excerpt.
    expect(drift.failure!.stdout).toContain('kaboom')
    expect(drift.failure!.stderr).toContain('kaboom at /boom')
    expect(drift.evidencePath).toBeTruthy()

    // The evidence bundle carries the api transcript + the server's own logs.
    const dir = path.join(r, drift.evidencePath!)
    expect(fs.readFileSync(path.join(dir, 'response.raw.txt'), 'utf-8')).toContain('kaboom')
    expect(fs.readFileSync(path.join(dir, 'server.stderr.txt'), 'utf-8')).toContain('kaboom at /boom')
    const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8'))
    expect(invocation.steps[0]).toMatchObject({ method: 'GET', path: '/boom', status: 500 })

    // The passing multi-step scenario recorded its capture.
    const pass = res.latest.scenarios.find((s) => s.id === 'create-fetch')!
    expect(pass.outcome).toBe('pass')
    const passDir = path.join(r, pass.evidencePath!)
    const passInvocation = JSON.parse(fs.readFileSync(path.join(passDir, 'invocation.json'), 'utf-8'))
    expect(passInvocation.steps[0].captured).toEqual({ todoId: '1' })
    expect(passInvocation.steps[1].path).toBe('/todos/1')
  })

  it('isolates state per scenario — each boots a fresh server in a fresh sandbox', async () => {
    const r = repo()
    writeApiRecipe(r)
    for (const id of ['iso-one', 'iso-two']) {
      writeScenario(
        r,
        `api/${id}.yaml`,
        apiScenario({
          id,
          binds: specBinds('a/b'),
          steps: [
            {
              request: { method: 'POST', path: '/todos', json: { title: `t-${id}` } },
              // A shared server would hand the second scenario id 2.
              expect: { status: 201, json: { id: { equals: 1 } } },
            },
          ],
        }),
      )
    }

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 2, fail: 0 })
  })

  it('runs cli and api scenarios side by side from one recipe', async () => {
    const r = repo()
    // One recipe with BOTH preparations: the cli fixture entry and the api block.
    writeApiRecipe(r, { entry: ['node', FIXTURE_BIN] })
    writeScenario(
      r,
      'cli/version.yaml',
      scenario({
        id: 'cli-ver',
        binds: specBinds('cli/version'),
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )
    writeScenario(
      r,
      'api/list.yaml',
      apiScenario({
        id: 'api-list',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200, json: { todos: { equals: [] } } } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 2 })
  })

  it('api scenarios without an api block settle as errors naming the gap; cli still runs', async () => {
    const r = repo()
    writeRecipe(r) // cli-only recipe
    writeScenario(
      r,
      'cli/version.yaml',
      scenario({ id: 'cli-ver', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeScenario(
      r,
      'api/list.yaml',
      apiScenario({
        id: 'api-list',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 1, error: 1 })
    const apiResult = res.latest.scenarios.find((s) => s.id === 'api-list')!
    expect(apiResult.outcome).toBe('error')
    expect(apiResult.failure!.actual).toContain('no `api` block')
  })

  it('a server that cannot start is ONE loud entry-preflight-failed, never N errors', async () => {
    const r = repo()
    writeApiRecipe(r, { serve: ['node', FIXTURE_API_CRASH] })
    for (const id of ['one', 'two']) {
      writeScenario(
        r,
        `api/${id}.yaml`,
        apiScenario({
          id,
          binds: specBinds('a/b'),
          steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
        }),
      )
    }

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('entry-preflight-failed')
    if (res.status !== 'entry-preflight-failed') return
    expect(res.preflight.entry).toContain('crash.mjs')
    expect(res.preflight.stderr).toContain('fixture crash')
  })

  it('a capture whose path resolves to nothing fails with the capture as the expectation', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/bad-capture.yaml',
      apiScenario({
        id: 'bad-capture',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/todos' },
            capture: { nope: 'todos[0].id' },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('fail')
    expect(result.failure!.expected).toContain('capture "nope"')
  })

  it('a ${var} nothing captured fails with the missing variable named', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/bad-var.yaml',
      apiScenario({
        id: 'bad-var',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos/${ghost}' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('fail')
    expect(result.failure!.expected).toContain('${ghost}')
  })

  it('runs api.services up before scenarios and down after', async () => {
    const r = repo()
    writeApiRecipe(r, {
      services: { up: 'touch svc-up.txt', down: 'touch svc-down.txt' },
    })
    writeScenario(
      r,
      'api/list.yaml',
      apiScenario({
        id: 'api-list',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    expect(fs.existsSync(path.join(r, 'svc-up.txt'))).toBe(true)
    expect(fs.existsSync(path.join(r, 'svc-down.txt'))).toBe(true)
  })

  it('a failing services.up surfaces as build-failed carrying the command', async () => {
    const r = repo()
    writeApiRecipe(r, { services: { up: 'false' } })
    writeScenario(
      r,
      'api/list.yaml',
      apiScenario({
        id: 'api-list',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('build-failed')
    if (res.status !== 'build-failed') return
    expect(res.build.command).toBe('false')
  })

  it('injects a declared credential into a header and masks it from all evidence', async () => {
    const r = repo()
    const SECRET = 'sk-live-super-secret-value'
    writeApiRecipe(r, {
      credentials: { 'api-key': { header: 'Authorization', value: SECRET } },
    })
    writeScenario(
      r,
      'api/auth.yaml',
      apiScenario({
        id: 'auth-echo',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:api-key}}' } },
            // The server reflects the header; asserting the mask proves substitution
            // happened (the real value reached the server) yet stays out of the doc.
            expect: { status: 200, json: { authorization: { equals: SECRET } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('pass')

    // The secret must appear NOWHERE in the evidence bundle; the mask stands in.
    const dir = path.join(r, result.evidencePath!)
    for (const f of fs.readdirSync(dir)) {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8')
      expect(content).not.toContain(SECRET)
    }
    // The server both echoed and logged the header — both are masked.
    expect(fs.readFileSync(path.join(dir, 'response.raw.txt'), 'utf-8')).toContain('«cred:api-key»')
    expect(fs.readFileSync(path.join(dir, 'server.stderr.txt'), 'utf-8')).toContain('«cred:api-key»')
  })

  it('masks a declared credential from the failure output of a failing step', async () => {
    const r = repo()
    const SECRET = 'sk-live-failing-secret'
    writeApiRecipe(r, {
      credentials: { 'api-key': { header: 'Authorization', value: SECRET } },
    })
    writeScenario(
      r,
      'api/auth-fail.yaml',
      apiScenario({
        id: 'auth-fail',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:api-key}}' } },
            // The reflected body carries the secret; the wrong status makes it fail,
            // so the response body rides `failure.stdout` — which must be masked.
            expect: { status: 500 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('fail')
    expect(result.failure!.stdout).toContain('«cred:api-key»')
    expect(result.failure!.stdout).not.toContain(SECRET)
    expect(result.failure!.stderr ?? '').not.toContain(SECRET)
  })

  it('resolves a credential from the host env at run start', async () => {
    const r = repo()
    const SECRET = 'env-sourced-secret'
    process.env.TC_TEST_API_KEY = SECRET
    try {
      writeApiRecipe(r, {
        credentials: { 'api-key': { header: 'Authorization', valueFromEnv: 'TC_TEST_API_KEY' } },
      })
      writeScenario(
        r,
        'api/auth-env.yaml',
        apiScenario({
          id: 'auth-env',
          binds: specBinds('a/b'),
          steps: [
            {
              request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:api-key}}' } },
              expect: { status: 200, json: { authorization: { equals: SECRET } } },
            },
          ],
        }),
      )
      const res = await runGuard({ repoRoot: r, skipBuild: true })
      expect(res.status).toBe('ok')
      if (res.status !== 'ok') return
      expect(res.latest.scenarios[0].outcome).toBe('pass')
    } finally {
      delete process.env.TC_TEST_API_KEY
    }
  })

  it('a missing credential env var stops the whole run loudly (never a silent skip)', async () => {
    const r = repo()
    delete process.env.TC_MISSING_KEY
    writeApiRecipe(r, {
      credentials: { 'api-key': { header: 'Authorization', valueFromEnv: 'TC_MISSING_KEY' } },
    })
    writeScenario(
      r,
      'api/list.yaml',
      apiScenario({
        id: 'api-list',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('missing-credential-env')
    if (res.status !== 'missing-credential-env') return
    expect(res.message).toContain('TC_MISSING_KEY')
    expect(res.message).toContain('api-key')
  })

  it('a scenario referencing an undeclared credential settles as an error, not a pass', async () => {
    const r = repo()
    writeApiRecipe(r) // no credentials declared
    writeScenario(
      r,
      'api/undeclared.yaml',
      apiScenario({
        id: 'undeclared-cred',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:ghost}}' } },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('error')
    expect(result.failure!.actual).toContain('ghost')
  })

  it('normalizers apply to the response body', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/norm.yaml',
      apiScenario({
        id: 'norm',
        binds: specBinds('a/b'),
        normalize: ['versions'],
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'release 1.2.3 today' } },
            expect: { status: 201, body: { contains: 'release <VERSION> today' } },
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
