/**
 * PER-STEP ACTUALS: what every EXECUTED step actually did, retained in the run's
 * evidence bundle (`invocation.json`) and read back with `parseGuardStepActuals`.
 *
 * The retention rules this file pins:
 *  - a PASSING scenario keeps a record for every one of its steps, not just the last
 *  - each record carries the exit code / status, the duration, and the step's own
 *    output, head-truncated exactly like a failure excerpt (never an unbounded blob)
 *  - a scenario that FAILED keeps records up to and including the failing step, and
 *    nothing after it — those steps did not run, so there is nothing to record
 *  - a CANCELLED scenario writes no bundle at all: its result is discarded, and an
 *    actual for a step whose verdict was thrown away would be an invention
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runGuard,
  runScenario,
  resolveEntry,
  STEP_OUTPUT_LIMIT,
  type RunScenarioContext,
} from '@truecourse/guard-runner'
import { parseGuardStepActuals } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeSpecDoc,
  writeApiRecipe,
  writeScenario,
  scenario,
  apiScenario,
  specBinds,
  FIXTURE_BIN,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  writeSpecDoc(r)
  repos.push(r)
  return r
}

function ctxFor(r: string, overrides: Partial<RunScenarioContext> = {}): RunScenarioContext {
  return {
    repoRoot: r,
    runId: 'test-run',
    unique: 'testuniq00',
    resolvedEntry: resolveEntry(r, ['node', FIXTURE_BIN]),
    stepTimeoutMs: 10_000,
    // A real run captures the pass bundle — that is where a green test's actuals live.
    capturePassEvidence: true,
    ...overrides,
  }
}

/** The actuals a scenario's bundle yields, read the way the dashboard reads them. */
function actualsOf(r: string, evidencePath: string) {
  const file = path.join(r, evidencePath, 'invocation.json')
  return parseGuardStepActuals(fs.readFileSync(file, 'utf-8'))
}

describe('per-step actuals — the cli driver', () => {
  it('records EVERY step of a PASSING scenario: exit code, duration, output', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'pass-3',
        steps: [
          { run: ['init'], expect: { exit: 0 } },
          { run: ['--version'], expect: { exit: 0, stdout: { contains: '2.4.1' } } },
          { run: ['whoami'], expect: { exit: 0 } },
        ],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('pass')

    const actuals = actualsOf(r, res.evidencePath!)
    expect(actuals.map((a) => a.n)).toEqual([1, 2, 3])
    expect(actuals.every((a) => a.actual === 'exit 0')).toBe(true)
    expect(actuals.every((a) => typeof a.durationMs === 'number')).toBe(true)
    // Each step's OWN output, not the last step's: the version step printed the
    // version, the identity step printed the sandboxed identity.
    expect(actuals[1].stdout).toContain('2.4.1')
    expect(actuals[2].stdout).toContain('home=')
    // An empty stream is omitted rather than kept as noise.
    expect(actuals[1].stderr).toBeUndefined()
  })

  it('head-truncates a step’s retained output, exactly like a failure excerpt', async () => {
    const r = repo()
    // `shout` echoes uppercased stdin — 4000 chars in, 4000 chars out, and the
    // bundle must not grow with it.
    const res = await runScenario(
      scenario({
        id: 'loud-pass',
        steps: [{ run: ['shout'], stdin: 'a'.repeat(4000), expect: { exit: 0 } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('pass')
    const actuals = actualsOf(r, res.evidencePath!)
    expect(actuals[0].stdout).toHaveLength(STEP_OUTPUT_LIMIT)
    expect(actuals[0].stdout).toBe('A'.repeat(STEP_OUTPUT_LIMIT))
  })

  it('records up to the FAILING step and nothing after it', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'stop-at-2',
        steps: [
          { run: ['--version'], expect: { exit: 0 } },
          { run: ['boom'], expect: { exit: 0 } },
          { run: ['whoami'], expect: { exit: 0 } },
        ],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')

    const actuals = actualsOf(r, res.evidencePath!)
    // The step that passed, then the one that broke — and step 3, which never ran,
    // has no record at all.
    expect(actuals.map((a) => a.n)).toEqual([1, 2])
    expect(actuals[0].actual).toBe('exit 0')
    expect(actuals[1].actual).toBe('exit 7')
    expect(actuals[1].stderr).toContain('fatal: intentional failure')
  })

  it('gives an infra failure its record too — the timing out step is still a fact', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'timeout-2',
        steps: [
          { run: ['--version'], expect: { exit: 0 } },
          { run: ['hang'], expect: { exit: 0 } },
        ],
      }),
      ctxFor(r, { stepTimeoutMs: 300 }),
    )
    expect(res.outcome).toBe('error')
    const actuals = actualsOf(r, res.evidencePath!)
    expect(actuals.map((a) => a.n)).toEqual([1, 2])
    expect(actuals[1].actual).toBe('timed out')
  })

  it('a step that spawns nothing returns nothing — never an invented exit code', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'file-step',
        steps: [
          { write: { 'notes.txt': 'hello' } },
          { run: ['--version'], expect: { exit: 0 } },
        ],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('pass')
    const actuals = actualsOf(r, res.evidencePath!)
    expect(actuals[0]).toMatchObject({ n: 1 })
    expect(actuals[0].actual).toBeUndefined()
    expect(actuals[0].stdout).toBeUndefined()
    expect(actuals[1].actual).toBe('exit 0')
  })

  it('a CANCELLED scenario retains nothing — its verdict was thrown away', async () => {
    const r = repo()
    const controller = new AbortController()
    const res = await runScenario(
      scenario({
        id: 'cancelled',
        steps: [
          { run: ['--version'], expect: { exit: 0 } },
          { run: ['--version'], expect: { exit: 0 } },
        ],
      }),
      ctxFor(r, {
        signal: controller.signal,
        onStep: () => controller.abort(),
      }),
    )
    expect(res.outcome).toBe('error')
    expect(res.evidencePath).toBeUndefined()
    expect(fs.existsSync(path.join(r, '.truecourse', 'guard', 'evidence', 'test-run', 'cancelled'))).toBe(
      false,
    )
  })

  it('a birth validation keeps a PASS unrecorded — there is no run to anchor it to', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({ id: 'birth-pass', steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
      ctxFor(r, { capturePassEvidence: false }),
    )
    expect(res.outcome).toBe('pass')
    expect(res.evidencePath).toBeUndefined()
  })
})

describe('per-step actuals — the api driver', () => {
  it('records each request’s status and response body, passing steps included', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/actuals.yaml',
      apiScenario({
        id: 'api-actuals',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } },
            capture: { todoId: 'id' },
            expect: { status: 201 },
          },
          { request: { method: 'GET', path: '/todos/${todoId}' }, expect: { status: 200 } },
        ],
      }),
    )

    const run = await runGuard({ repoRoot: r, skipBuild: true })
    expect(run.status).toBe('ok')
    if (run.status !== 'ok') return
    const res = run.latest.scenarios[0]
    expect(res.outcome).toBe('pass')

    const actuals = actualsOf(r, res.evidencePath!)
    expect(actuals.map((a) => a.actual)).toEqual(['status 201', 'status 200'])
    // The response body is the api analog of stdout — one per step, not just the last.
    expect(actuals[0].stdout).toContain('buy milk')
    expect(actuals[1].stdout).toContain('buy milk')
  })
})
