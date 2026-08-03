/**
 * The api driver's SERVER-PROCESS steps: `boot`, `signal`, `logs`.
 * Every case runs the real fixture server through `runGuard` — no docker, no
 * network — so the process semantics (exit codes, signals, restarts, captured
 * output) are exercised against a real child, not a stub of one.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, runApiScenario } from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeScenario,
  apiScenario,
  specBinds,
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

/** Run one scenario and return its result row. */
async function runOne(r: string, steps: unknown[], id = 'lifecycle'): Promise<GuardScenarioResult> {
  writeScenario(
    r,
    `api/${id}.yaml`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiScenario({ id, binds: specBinds('a/b'), steps: steps as any }),
  )
  const res = await runGuard({ repoRoot: r, skipBuild: true })
  expect(res.status).toBe('ok')
  if (res.status !== 'ok') throw new Error('run failed')
  return res.latest.scenarios.find((s) => s.id === id)!
}

describe('api driver — boot steps', () => {
  it('an explicit boot replaces the implicit one and serves requests', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: { expect: { ready: true } } },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('a boot with no expect defaults to ready', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('BACK-COMPAT: a scenario with no boot step keeps the implicit boot', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }])
    expect(row.outcome).toBe('pass')
  })

  it('layers `boot.env` over the recipe env for THAT boot only', async () => {
    const r = repo()
    writeApiRecipe(r, { apiEnv: { TC_BOOT_MARKER: 'from-recipe' } })
    const row = await runOne(r, [
      // The overlay wins for the first boot…
      { boot: { env: { TC_BOOT_MARKER: 'from-step' } } },
      { request: { method: 'GET', path: '/boot' }, expect: { json: { 'env.TC_BOOT_MARKER': { equals: 'from-step' } } } },
      // …and the next boot, which declares none, is back to the recipe's value.
      { boot: {} },
      { request: { method: 'GET', path: '/boot' }, expect: { json: { 'env.TC_BOOT_MARKER': { equals: 'from-recipe' } } } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('every boot gets a FRESH port — `${PORT}` re-substitutes per boot', async () => {
    const r = repo()
    writeApiRecipe(r, { apiEnv: { TC_PORT_ECHO: 'port-${PORT}' } })
    const row = await runOne(r, [
      { boot: {} },
      { request: { method: 'GET', path: '/boot' }, capture: { first: 'env.TC_PORT_ECHO' }, expect: { status: 200 } },
      { boot: {} },
      { request: { method: 'GET', path: '/boot' }, capture: { second: 'env.TC_PORT_ECHO' }, expect: { status: 200 } },
    ])
    expect(row.outcome).toBe('pass')
    const dir = path.join(r, row.evidencePath!)
    const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8'))
    const first = invocation.steps[1].captured.first as string
    const second = invocation.steps[3].captured.second as string
    expect(first).toMatch(/^port-\d+$/)
    expect(second).toMatch(/^port-\d+$/)
    // A second boot reusing the first port would make the template resolve the same.
    expect(second).not.toBe(first)
  })

  it('a boot expecting a non-zero exit asserts the exit code and stderr', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      {
        boot: {
          env: { TC_FAIL_BOOT: '1' },
          expect: { exitCode: 1, stderrContains: ['boot-fail: fixture refused to boot'] },
        },
      },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('FAILS when a boot expected to exit stays up', async () => {
    const r = repo()
    writeApiRecipe(r, { readyTimeoutMs: 2_000 })
    const row = await runOne(r, [{ boot: { expect: { exitCode: 1 } } }])
    expect(row.outcome).toBe('fail')
    expect(row.failure).toMatchObject({ step: 1, expected: 'the server process to exit' })
  })

  it('FAILS with the wrong exit code, quoting the process stderr', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [{ boot: { env: { TC_FAIL_BOOT: '1' }, expect: { exitCode: 3 } } }])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.expected).toContain('exit with code 3')
    expect(row.failure!.actual).toContain('exited with code 1')
  })

  it('FAILS when the expected stderr line is missing', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: { env: { TC_FAIL_BOOT: '1' }, expect: { exitCode: 1, stderrContains: ['not printed anywhere'] } } },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.expected).toContain('not printed anywhere')
  })

  it('FAILS (not errors) when a boot expecting `ready` never turns healthy', async () => {
    const r = repo()
    writeApiRecipe(r, { readyTimeoutMs: 1_500 })
    const row = await runOne(r, [{ boot: { env: { TC_HEALTH_FAIL: '1' } } }])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.expected).toContain('become healthy')
  })

  it('ERRORS (never fails) when the serve argv cannot be spawned at all', async () => {
    // Driven through `runApiScenario` directly: a recipe whose serve argv does not
    // exist never gets past the run-level boot preflight, and the point here is the
    // STEP's own classification — a process that never existed cannot have had its
    // readiness judged, so it is infrastructure.
    const r = repo()
    const row = await runApiScenario(
      apiScenario({
        id: 'spawn-fail',
        binds: specBinds('a/b'),
        steps: [{ boot: {} } as never],
      }),
      {
        repoRoot: r,
        runId: 'run-1',
        server: {
          name: 'default',
          resolvedServe: ['/definitely/not/an/executable'],
          cwd: 'sandbox',
          healthPath: '/health',
          readyTimeoutMs: 2_000,
        },
        unique: 'u',
        stepTimeoutMs: 5_000,
        capturePassEvidence: false,
      },
    )
    expect(row.outcome).toBe('error')
    expect(row.failure!.actual).toContain('failed to spawn')
  })

  it('ERRORS when a request precedes the first boot of a lifecycle scenario', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
      { boot: {} },
    ])
    expect(row.outcome).toBe('error')
    expect(row.failure!.actual).toContain('no server is running')
  })
})

describe('api driver — signal steps', () => {
  it('SIGTERM shuts the server down with exit code 0', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 5_000 } } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('SIGINT shuts the server down with exit code 0', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { signal: { name: 'SIGINT', expect: { exitCode: 0 } } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('FAILS on the wrong shutdown exit code', async () => {
    const r = repo()
    writeApiRecipe(r, { apiEnv: { TC_SHUTDOWN_EXIT: '7' } })
    const row = await runOne(r, [{ boot: {} }, { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } }])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.actual).toContain('exited with code 7')
  })

  it('FAILS when the server ignores the signal past `withinMs`', async () => {
    const r = repo()
    writeApiRecipe(r, { apiEnv: { TC_IGNORE_SIGNALS: '1' } })
    const row = await runOne(r, [
      { boot: {} },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 800 } } },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.actual).toContain('still running')
  })

  it('ERRORS when nothing is running to signal', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: { env: { TC_FAIL_BOOT: '1' }, expect: { exitCode: 1 } } },
      { signal: { name: 'SIGTERM' } },
    ])
    expect(row.outcome).toBe('error')
    expect(row.failure!.actual).toContain('no server is running')
  })

  it('restart persistence: state written before the restart survives it', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      {
        request: { method: 'POST', path: '/todos', json: { title: 'survive-me' } },
        expect: { status: 201 },
        milestone: 1,
      },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
      { boot: {} },
      // The fixture persists to ./todos.json in the sandbox cwd, which both boots share.
      {
        request: { method: 'GET', path: '/todos' },
        expect: { status: 200, json: { 'todos[0].title': { equals: 'survive-me' } } },
        milestone: 2,
      },
    ])
    expect(row.outcome).toBe('pass')
  })
})

describe('api driver — logs steps', () => {
  it('matches a line the server wrote (substring)', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { logs: { stream: 'stdout', match: 'todos fixture listening' } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('matches the per-request log line by regex, scoped to the previous step', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
      {
        logs: {
          stream: 'stdout',
          match: { pattern: '^GET /todos 200 \\d+ms$' },
          sinceLastStep: true,
          count: 1,
        },
      },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('`sinceLastStep` narrows the window to what the previous step produced', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      // Once THIS step has seen the banner, it is provably in the buffer…
      { logs: { stream: 'stdout', match: 'todos fixture listening' } },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
      // …and the window opened at the start of the request step excludes it.
      { logs: { stream: 'stdout', match: 'todos fixture listening', sinceLastStep: true, count: 0 } },
      // The request's own line IS in that same window.
      { logs: { stream: 'stdout', match: 'GET /todos', sinceLastStep: true, count: 1 } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('reads stderr too', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { request: { method: 'GET', path: '/boom' }, expect: { status: 500 } },
      { logs: { stream: 'stderr', match: 'kaboom at /boom', sinceLastStep: true } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('FAILS when no line matches, quoting the window', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { logs: { stream: 'stdout', match: 'a line the fixture never writes', withinMs: 300 } },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.expected).toContain('a line the fixture never writes')
    expect(row.failure!.actual).toContain('0 line(s) matched')
  })

  it('FAILS on a count mismatch — "one line per request" is assertable', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
      { logs: { stream: 'stdout', match: 'GET /todos', sinceLastStep: true, count: 2, withinMs: 300 } },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.actual).toContain('1 line(s) matched')
  })

  it('a boot that EXITED still leaves its output readable', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: { env: { TC_FAIL_BOOT: '1' }, expect: { exitCode: 1 } } },
      { logs: { stream: 'stdout', match: 'anything' } },
    ])
    // A boot HAS happened here (it exited), so the logs step is legitimate: the
    // failing boot's own output is still readable.
    expect(row.outcome).toBe('fail')
  })

  it('logs written BEFORE a restart are still readable after it', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: {} },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
      { boot: {} },
      { logs: { stream: 'stdout', match: 'GET /todos' } },
      { logs: { stream: 'stdout', match: 'todos fixture listening', count: 2 } },
    ])
    expect(row.outcome).toBe('pass')
  })
})

describe('api driver — lifecycle evidence', () => {
  it('records lifecycle steps in the transcript and invocation.json', async () => {
    const r = repo()
    writeApiRecipe(r)
    const row = await runOne(r, [
      { boot: { env: { TC_BOOT_MARKER: 'x' } } },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
      { boot: {} },
      { logs: { stream: 'stdout', match: 'listening', count: 2 } },
      { request: { method: 'GET', path: '/todos' }, expect: { status: 404 } },
    ])
    expect(row.outcome).toBe('fail')
    const dir = path.join(r, row.evidencePath!)
    const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8'))
    expect(invocation.steps[0]).toMatchObject({ kind: 'boot', action: 'boot the server (env: TC_BOOT_MARKER=x)' })
    expect(invocation.steps[1]).toMatchObject({ kind: 'signal', expectation: 'exits 0' })
    expect(invocation.steps[3]).toMatchObject({ kind: 'logs' })
    const transcript = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('signal:  signal SIGTERM')
    // The stdout of BOTH boots is in the bundle.
    const stdout = fs.readFileSync(path.join(dir, 'server.stdout.txt'), 'utf-8')
    expect(stdout.match(/todos fixture listening/g)).toHaveLength(2)
  })

  it('a crash fixture that exits is assertable as a boot expectation', async () => {
    const r = repo()
    const row = await runApiScenario(
      apiScenario({
        id: 'crash-boot',
        binds: specBinds('a/b'),
        steps: [{ boot: { expect: { exitCode: 1, stderrContains: ['fixture crash'] } } } as never],
      }),
      {
        repoRoot: r,
        runId: 'run-1',
        server: {
          name: 'default',
          resolvedServe: [process.execPath, FIXTURE_API_CRASH],
          cwd: 'sandbox',
          healthPath: '/health',
          readyTimeoutMs: 5_000,
        },
        unique: 'u',
        stepTimeoutMs: 5_000,
        capturePassEvidence: false,
      },
    )
    expect(row.outcome).toBe('pass')
  })
})
