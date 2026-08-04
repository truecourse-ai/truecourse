import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runGuard,
  detectNoOpAnomaly,
  foldStepStats,
  emptyStepStats,
  isNoOpStep,
  isInertRequest,
  NO_OP_STEP_THRESHOLD_MS,
  ANOMALY_MIN_EXECUTED_STEPS,
  ANOMALY_NOOP_FRACTION,
  type GuardRunStepStats,
  type StepObservation,
  type ApiStepObservation,
} from '@truecourse/guard-runner'
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
import { fileURLToPath } from 'node:url'

const FIXTURE_API_INERT = fileURLToPath(new URL('../fixtures/guard-fixture-api/server-inert.mjs', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/**
 * A genuinely instant, silent, exit-0 entry — a COPY of the system `true` binary
 * under a non-no-op name (the recipe schema rejects an entry literally named
 * `true`). It ignores its arguments in ~1-3ms, exactly like the incident recipe,
 * but reaches this defense-in-depth gate instead of the schema reject.
 */
function seedInstantSilentEntry(r: string): void {
  const src = ['/usr/bin/true', '/bin/true'].find((p) => fs.existsSync(p))
  if (!src) throw new Error('no system `true` binary found for the instant-no-op entry')
  const dest = path.join(r, 'runner')
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o755)
  writeRecipe(r, { entry: ['./runner'] })
}

/** Seed `n` cli scenarios that each run one step and assert exit 0. */
function seedExitZeroScenarios(r: string, n: number, run: string[]): void {
  for (let i = 0; i < n; i++) {
    writeScenario(
      r,
      `s${i}.yaml`,
      scenario({ id: `s${i}`, binds: specBinds('a/b'), steps: [{ run, expect: { exit: 0 } }] }),
    )
  }
}

const obs = (over: Partial<StepObservation>): StepObservation => ({
  exitCode: 0,
  stdoutEmpty: true,
  stderrEmpty: true,
  durationMs: 1,
  ...over,
})

const apiObs = (over: Partial<ApiStepObservation>): ApiStepObservation => ({
  status: 404,
  bodyEmpty: true,
  timedOut: false,
  requestLine: 'GET /a',
  durationMs: 1,
  ...over,
})

describe('isNoOpStep', () => {
  it('is true only for exit 0, empty streams, under the threshold', () => {
    expect(isNoOpStep(obs({}), 10)).toBe(true)
    expect(isNoOpStep(obs({ exitCode: 1 }), 10)).toBe(false) // nonzero exit
    expect(isNoOpStep(obs({ stdoutEmpty: false }), 10)).toBe(false) // wrote stdout
    expect(isNoOpStep(obs({ stderrEmpty: false }), 10)).toBe(false) // wrote stderr
    expect(isNoOpStep(obs({ durationMs: 50 }), 10)).toBe(false) // too slow to be a no-op
    expect(isNoOpStep(obs({ exitCode: null }), 10)).toBe(false) // killed (timeout/signal)
  })
})

describe('isInertRequest', () => {
  it('is true only for a COMPLETED request with an empty body — timing never enters', () => {
    expect(isInertRequest(apiObs({}))).toBe(true)
    expect(isInertRequest(apiObs({ durationMs: 5000 }))).toBe(true) // slow but empty — still inert
    expect(isInertRequest(apiObs({ bodyEmpty: false }))).toBe(false) // the server said something
    expect(isInertRequest(apiObs({ timedOut: true, status: null }))).toBe(false) // never answered
  })
})

/** Synthetic per-driver stats — the unit-test lever over the aggregate judge. */
function stats(over: {
  cli?: Partial<GuardRunStepStats['cli']>
  api?: Partial<GuardRunStepStats['api']>
}): GuardRunStepStats {
  const base = emptyStepStats(10)
  return {
    cli: { ...base.cli, ...over.cli },
    api: { ...base.api, ...over.api },
  }
}

describe('detectNoOpAnomaly — cli', () => {
  const cli = (executedSteps: number, noOpSteps: number) => stats({ cli: { executedSteps, noOpSteps } })

  it('fires only when the sample is large enough AND the no-op fraction is overwhelming', () => {
    expect(detectNoOpAnomaly(cli(ANOMALY_MIN_EXECUTED_STEPS, ANOMALY_MIN_EXECUTED_STEPS))).not.toBeNull()
    // Under the minimum sample — never fires no matter how no-op it is.
    expect(detectNoOpAnomaly(cli(ANOMALY_MIN_EXECUTED_STEPS - 1, ANOMALY_MIN_EXECUTED_STEPS - 1))).toBeNull()
    // Enough steps but the fraction is under the bar.
    expect(detectNoOpAnomaly(cli(20, 17))).toBeNull() // 0.85 < 0.9
    expect(detectNoOpAnomaly(cli(20, 18))).not.toBeNull() // 0.90 >= 0.9
  })

  it('reports the tripping counts and fraction', () => {
    const a = detectNoOpAnomaly(cli(25, 24))!
    expect(a).toMatchObject({ driver: 'cli', executedSteps: 25, noOpSteps: 24, thresholdMs: 10 })
    if (a.driver === 'cli') expect(a.fraction).toBeCloseTo(24 / 25)
  })
})

describe('detectNoOpAnomaly — api', () => {
  const api = (over: Partial<GuardRunStepStats['api']>) => stats({ api: over })
  const DEAD = {
    executedRequests: 20,
    inertRequests: 20,
    statuses: [404],
    requestLines: ['GET /a', 'POST /b'],
  }

  it('fires on an overwhelmingly empty, status-uniform sample spanning route variety', () => {
    const a = detectNoOpAnomaly(api(DEAD))
    expect(a).toMatchObject({ driver: 'api', executedRequests: 20, inertRequests: 20, status: 404, requestLines: 2 })
  })

  it('never fires under the minimum sample', () => {
    expect(detectNoOpAnomaly(api({ ...DEAD, executedRequests: 19, inertRequests: 19 }))).toBeNull()
  })

  it('never fires when the empty fraction is under the bar', () => {
    expect(detectNoOpAnomaly(api({ ...DEAD, inertRequests: 17 }))).toBeNull() // 0.85 < 0.9
    expect(detectNoOpAnomaly(api({ ...DEAD, inertRequests: 18 }))).not.toBeNull() // 0.90
  })

  it('never fires when statuses VARY — a server distinguishing requests is alive', () => {
    expect(detectNoOpAnomaly(api({ ...DEAD, statuses: [204, 404] }))).toBeNull()
  })

  it('never fires on a SINGLE route — a healthy 204-empty endpoint hammered 20 times', () => {
    // The false-positive guard: uniform-empty on one route says nothing about
    // "every route answers identically", so a legitimate empty-response endpoint
    // (a DELETE answering 204) can never be mistaken for a dead stub.
    expect(
      detectNoOpAnomaly(api({ executedRequests: 20, inertRequests: 20, statuses: [204], requestLines: ['DELETE /todos/1'] })),
    ).toBeNull()
  })
})

describe('foldStepStats', () => {
  it('adds counts and unions the distinct sets', () => {
    const a = stats({
      cli: { executedSteps: 5, noOpSteps: 4 },
      api: { executedRequests: 10, inertRequests: 9, statuses: [404], requestLines: ['GET /a'] },
    })
    const b = stats({
      cli: { executedSteps: 3, noOpSteps: 3 },
      api: { executedRequests: 10, inertRequests: 10, statuses: [404, 200], requestLines: ['GET /a', 'POST /b'] },
    })
    const folded = foldStepStats(a, b)
    expect(folded.cli).toMatchObject({ executedSteps: 8, noOpSteps: 7 })
    expect(folded.api).toEqual({
      executedRequests: 20,
      inertRequests: 19,
      statuses: [200, 404],
      requestLines: ['GET /a', 'POST /b'],
    })
  })
})

describe('runGuard — cli no-op anomaly signal (real subprocess, end to end)', () => {
  it('surfaces the anomaly on the ok result WITHOUT aborting the run', async () => {
    // A copy of `true`: ignores its arguments, exit 0, no output. Uses a generous
    // threshold so process-spawn overhead never disqualifies the (genuinely silent,
    // exit-0) steps — the sub-10ms default is validated by the isNoOpStep unit test.
    const r = repo()
    seedInstantSilentEntry(r)
    const n = 22
    seedExitZeroScenarios(r, n, ['anything'])

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false, noOpThresholdMs: 1_000 })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return

    // The run still COMPLETES — every scenario passes (they only assert exit 0).
    expect(res.latest.summary).toMatchObject({ total: n, pass: n })

    // The aggregate and the loud anomaly are both surfaced on the result.
    expect(res.stepStats!.cli.executedSteps).toBe(n)
    expect(res.stepStats!.cli.noOpSteps).toBe(n) // every step was silent + exit 0
    expect(res.stepStats!.cli.thresholdMs).toBe(1_000)
    expect(res.anomaly).not.toBeNull()
    expect(res.anomaly!.driver).toBe('cli')
    expect(res.anomaly!.fraction).toBeGreaterThanOrEqual(ANOMALY_NOOP_FRACTION)
  })

  it('a small sample (under the minimum) never trips the anomaly', async () => {
    const r = repo()
    seedInstantSilentEntry(r)
    seedExitZeroScenarios(r, 5, ['anything'])

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.stepStats!.cli.executedSteps).toBe(5)
    expect(res.stepStats!.cli.thresholdMs).toBe(NO_OP_STEP_THRESHOLD_MS) // production default when unset
    expect(res.anomaly).toBeNull()
  })

  it('a healthy entry that PRODUCES output never trips the anomaly, even at scale', async () => {
    // relkit `--version` writes its version and exits 0 → not a no-op, so no anomaly.
    const r = repo()
    writeRecipe(r) // default fixture entry
    seedExitZeroScenarios(r, 22, ['--version'])

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 22, pass: 22 })
    expect(res.stepStats!.cli.executedSteps).toBe(22)
    expect(res.stepStats!.cli.noOpSteps).toBe(0) // every step wrote output
    expect(res.anomaly).toBeNull()
  })
})

describe('runGuard — api dead-stub anomaly signal (real server, end to end)', () => {
  /** 20 request steps split across two routes, all expecting the stub's uniform 404. */
  const deadStubSteps = () => [
    ...Array.from({ length: 10 }, () => ({ request: { method: 'GET', path: '/alpha' }, expect: { status: 404 } })),
    ...Array.from({ length: 10 }, () => ({ request: { method: 'POST', path: '/beta', json: {} }, expect: { status: 404 } })),
  ]

  it('surfaces the anomaly when every route answers the same empty status', async () => {
    const r = repo()
    writeApiRecipe(r, { serve: ['node', FIXTURE_API_INERT], healthPath: '/health' })
    writeScenario(r, 'dead.yaml', apiScenario({ id: 'dead', binds: specBinds('a/b'), steps: deadStubSteps() }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return

    // Every step PASSED (the stub really does answer 404) — that is the nightmare
    // this gate exists for: a green run proving nothing.
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
    expect(res.stepStats!.api).toEqual({
      executedRequests: 20,
      inertRequests: 20,
      statuses: [404],
      requestLines: ['GET /alpha', 'POST /beta'],
    })
    expect(res.anomaly).toMatchObject({ driver: 'api', status: 404, requestLines: 2 })
  })

  it('never trips on a single hammered route — no route variety, no uniformity claim', async () => {
    const r = repo()
    writeApiRecipe(r, { serve: ['node', FIXTURE_API_INERT], healthPath: '/health' })
    const steps = Array.from({ length: 20 }, () => ({ request: { method: 'GET', path: '/alpha' }, expect: { status: 404 } }))
    writeScenario(r, 'one-route.yaml', apiScenario({ id: 'one-route', binds: specBinds('a/b'), steps }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.stepStats!.api.requestLines).toEqual(['GET /alpha'])
    expect(res.anomaly).toBeNull()
  })

  it('a healthy server that ANSWERS never trips the anomaly, even at scale', async () => {
    const r = repo()
    writeApiRecipe(r) // the todos fixture server
    const steps = Array.from({ length: 20 }, () => ({
      request: { method: 'GET', path: '/todos' },
      expect: { status: 200 },
    }))
    writeScenario(r, 'healthy.yaml', apiScenario({ id: 'healthy', binds: specBinds('a/b'), steps }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
    expect(res.stepStats!.api.executedRequests).toBe(20)
    expect(res.stepStats!.api.inertRequests).toBe(0) // every response carried a body
    expect(res.anomaly).toBeNull()
  })
})
