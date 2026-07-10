/**
 * Run-level cancellation: `buildTimeoutMs` threading into the build, an external
 * `AbortSignal` (→ status `aborted`, phase build|run), and the overall
 * `runTimeoutMs` wall-clock (→ status `run-timed-out`, in-flight scenarios
 * killed). All timings are tiny; a prompt return is itself the proof that the
 * children were killed rather than left to their 30s step timeout.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { runGuard, guardLatestPath } from '@truecourse/guard-runner'
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

const HANGING_BUILD = 'node -e "setInterval(() => {}, 1000)"'

describe('runGuard — buildTimeoutMs', () => {
  it('replaces the default build timeout: a hanging build fails fast as timed out', async () => {
    const r = repo()
    writeRecipe(r, { build: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const start = Date.now()
    const res = await runGuard({ repoRoot: r, buildTimeoutMs: 200 })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res.status).toBe('build-failed')
    if (res.status === 'build-failed') expect(res.build.timedOut).toBe(true)
  })
})

describe('runGuard — external AbortSignal', () => {
  it('a pre-aborted signal returns { aborted, phase: build } without running anything', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const ac = new AbortController()
    ac.abort()
    const res = await runGuard({ repoRoot: r, signal: ac.signal })
    expect(res).toEqual({ status: 'aborted', phase: 'build' })
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })

  it('aborting during the build kills the build child and reports phase build', async () => {
    const r = repo()
    writeRecipe(r, { build: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const ac = new AbortController()
    const start = Date.now()
    const pending = runGuard({
      repoRoot: r,
      signal: ac.signal,
      onPhase: (phase) => {
        if (phase === 'build') setTimeout(() => ac.abort(), 50)
      },
    })
    const res = await pending
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res).toEqual({ status: 'aborted', phase: 'build' })
  })

  it('aborting during the run kills in-flight scenarios and reports phase run', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'hang.yaml',
      scenario({ id: 'hang', binds: specBinds('cli/boom'), steps: [{ run: ['hang'], expect: { exit: 0 } }] }),
    )

    const ac = new AbortController()
    const start = Date.now()
    const res = await runGuard({
      repoRoot: r,
      skipBuild: true,
      signal: ac.signal,
      onPhase: (phase) => {
        if (phase === 'run') setTimeout(() => ac.abort(), 100)
      },
    })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res).toEqual({ status: 'aborted', phase: 'run' })
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })
})

describe('runGuard — runTimeoutMs', () => {
  it('an exceeded run wall-clock aborts in-flight scenarios and reports settled/total', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'fast.yaml',
      scenario({ id: 'fast', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeScenario(
      r,
      'hang.yaml',
      scenario({ id: 'hang', binds: specBinds('cli/boom'), steps: [{ run: ['hang'], expect: { exit: 0 } }] }),
    )

    const start = Date.now()
    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 2, runTimeoutMs: 1_000 })
    const took = Date.now() - start
    expect(took).toBeLessThan(10_000)
    expect(res.status).toBe('run-timed-out')
    if (res.status !== 'run-timed-out') return
    expect(res.total).toBe(2)
    expect(res.settled).toBe(1)
    expect(res.elapsedMs).toBeGreaterThanOrEqual(1_000)
    // A timed-out run persists nothing — no LATEST, no baseline movement.
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })

  it('a run-timer expiry during the build reports run-timed-out with zero settled', async () => {
    const r = repo()
    writeRecipe(r, { build: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const start = Date.now()
    const res = await runGuard({ repoRoot: r, runTimeoutMs: 200 })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res.status).toBe('run-timed-out')
    if (res.status !== 'run-timed-out') return
    expect(res.settled).toBe(0)
    expect(res.total).toBe(1)
  })
})
