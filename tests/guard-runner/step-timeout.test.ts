/**
 * Per-step time limit (cli driver): a step may declare `timeoutMs`, and the runner
 * gives THAT child exactly that much wall clock. The run-wide default is unchanged
 * — a step that declares nothing is still bound by it, including a sibling of a
 * step that declared one.
 *
 * Why it exists: a documented command that sends source code to a model answers in
 * minutes, and the default is sized for a command that answers immediately. Without
 * a per-step budget the only lever is the run-wide one, which would slacken every
 * other step in the corpus to accommodate one.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { runGuard, DEFAULT_STEP_TIMEOUT_MS } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** `hold` sleeps TC_CLI_HOLD_MS and exits 0 — a step that legitimately takes time. */
const SLOW_ENV = { TC_CLI_HOLD_DIR: '${sandbox}', TC_CLI_HOLD_MS: '900' }

describe('a step’s declared timeoutMs', () => {
  it('is honoured over a SHORTER run default — the slow command completes and passes', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'slow.yaml',
      scenario({
        id: 'slow',
        setup: { env: SLOW_ENV },
        steps: [{ run: ['hold'], timeoutMs: 20_000, expect: { exit: 0, stdout: { contains: 'held' } } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, stepTimeoutMs: 300 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('the SAME step without it is killed by the run default — the budget is what changed', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'slow.yaml',
      scenario({
        id: 'slow',
        setup: { env: SLOW_ENV },
        steps: [{ run: ['hold'], expect: { exit: 0, stdout: { contains: 'held' } } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, stepTimeoutMs: 300 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const [result] = res.latest.scenarios
    // A timeout is infrastructure, never a verdict about the program.
    expect(result.outcome).toBe('error')
    expect(result.failure!.actual).toBe('step timed out after 300ms')
  })

  it('bounds the step it is declared on and nothing else — the sibling keeps the default', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'mixed.yaml',
      scenario({
        id: 'mixed',
        setup: { env: SLOW_ENV },
        steps: [
          // Passes only because of its own budget…
          { run: ['hold'], timeoutMs: 20_000, expect: { exit: 0 } },
          // …and the next step does NOT inherit it.
          { run: ['hang'], expect: { exit: 0 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, stepTimeoutMs: 500 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const [result] = res.latest.scenarios
    expect(result.outcome).toBe('error')
    expect(result.failure).toMatchObject({ step: 2, actual: 'step timed out after 500ms' })
  })

  it('is what the timeout MESSAGE reports — the reader sees the budget that actually applied', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'hang.yaml',
      scenario({ id: 'hang', steps: [{ run: ['hang'], timeoutMs: 700, expect: { exit: 0 } }] }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, stepTimeoutMs: 30_000 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const [result] = res.latest.scenarios
    expect(result.outcome).toBe('error')
    expect(result.failure!.actual).toBe('step timed out after 700ms')
    // It really did die on its own (short) budget, not the run's long one.
    expect(result.durationMs).toBeLessThan(10_000)
  })

  it('applies to a git step too', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'git-slow.yaml',
      scenario({
        id: 'git-slow',
        setup: { git: {} },
        steps: [{ git: ['status', '--porcelain'], timeoutMs: 20_000, expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, stepTimeoutMs: 20_000 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('leaves the default itself alone', () => {
    // The knob is additive: nothing about a corpus that declares none has moved.
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(30_000)
  })
})
