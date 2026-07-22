import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runGuard,
  detectNoOpAnomaly,
  isNoOpStep,
  NO_OP_STEP_THRESHOLD_MS,
  ANOMALY_MIN_EXECUTED_STEPS,
  ANOMALY_NOOP_FRACTION,
  type GuardRunStepStats,
  type StepObservation,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

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

/** Seed `n` scenarios that each run one step and assert exit 0 — all bind to a live section. */
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

describe('detectNoOpAnomaly', () => {
  const stats = (executedSteps: number, noOpSteps: number): GuardRunStepStats => ({ executedSteps, noOpSteps, thresholdMs: 10 })

  it('fires only when the sample is large enough AND the no-op fraction is overwhelming', () => {
    expect(detectNoOpAnomaly(stats(ANOMALY_MIN_EXECUTED_STEPS, ANOMALY_MIN_EXECUTED_STEPS))).not.toBeNull()
    // Under the minimum sample — never fires no matter how no-op it is.
    expect(detectNoOpAnomaly(stats(ANOMALY_MIN_EXECUTED_STEPS - 1, ANOMALY_MIN_EXECUTED_STEPS - 1))).toBeNull()
    // Enough steps but the fraction is under the bar.
    expect(detectNoOpAnomaly(stats(20, 17))).toBeNull() // 0.85 < 0.9
    expect(detectNoOpAnomaly(stats(20, 18))).not.toBeNull() // 0.90 >= 0.9
  })

  it('reports the tripping counts and fraction', () => {
    const a = detectNoOpAnomaly(stats(25, 24))!
    expect(a).toMatchObject({ executedSteps: 25, noOpSteps: 24, thresholdMs: 10 })
    expect(a.fraction).toBeCloseTo(24 / 25)
  })
})

describe('runGuard — no-op anomaly signal (real subprocess, end to end)', () => {
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

    // The aggregate and the loud anomaly are both surfaced for the CLI to warn on.
    expect(res.stepStats.executedSteps).toBe(n)
    expect(res.stepStats.noOpSteps).toBe(n) // every step was silent + exit 0
    expect(res.stepStats.thresholdMs).toBe(1_000)
    expect(res.anomaly).not.toBeNull()
    expect(res.anomaly!.executedSteps).toBe(n)
    expect(res.anomaly!.fraction).toBeGreaterThanOrEqual(ANOMALY_NOOP_FRACTION)
  })

  it('a small sample (under the minimum) never trips the anomaly', async () => {
    const r = repo()
    seedInstantSilentEntry(r)
    seedExitZeroScenarios(r, 5, ['anything'])

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.stepStats.executedSteps).toBe(5)
    expect(res.stepStats.thresholdMs).toBe(NO_OP_STEP_THRESHOLD_MS) // production default when unset
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
    expect(res.stepStats.executedSteps).toBe(22)
    expect(res.stepStats.noOpSteps).toBe(0) // every step wrote output
    expect(res.anomaly).toBeNull()
  })
})
