/**
 * THE DETERMINISTIC PRE-PASS (plan 05 step 21, item 1) — the failures that
 * explain themselves off facts the stores already hold, settled with the
 * machine as the author and ZERO sessions.
 *
 * Two halves, and the second is the one that matters: the rules are pure and
 * cheap to pin, but the claim the plan actually makes is that a board of
 * self-explaining failures costs NO agent session at all. So the last describe
 * drives the real command and asserts the sessions store was never created.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CAPABILITY_SETUP_EXPECTED, writeGuardLatest, writeManifest } from '@truecourse/guard-runner'
import {
  actualMatchesPrediction,
  deterministicVerdict,
} from '../../packages/core/src/services/guard-adjudicate/pre-pass'
import { runGuardAdjudication } from '../../packages/core/src/commands/guard-adjudicate'
import { board, failRow, item, makeRepo, manifestWith, rmrf, RUN_ID } from './guard-adjudicate-helpers'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeRepo()
  repos.push(r)
  return r
}

const EXPECTED_RED = {
  step: 3,
  predictedActual: 'exit 2',
  verdict: 'doc-drift' as const,
  brief: 'the doc promises the flag; the CLI has never accepted it',
}

// ---------------------------------------------------------------------------
// 1. The declared red, reproduced
// ---------------------------------------------------------------------------

describe('deterministicVerdict — a declared expected-red settles itself', () => {
  it('restates the worker’s own adjudication when the failing step and the actual match', () => {
    const auto = deterministicVerdict(item({ expectedRed: EXPECTED_RED }))

    expect(auto).not.toBeNull()
    expect(auto!.class).toBe('expected-red')
    expect(auto!.confidence).toBe('high')
    expect(auto!.mechanism).toBe(EXPECTED_RED.brief)
    expect(auto!.evidence.join('\n')).toContain('exit 2 — unknown flag')
  })

  /**
   * CONTAINMENT, one direction only. The worker copies `predictedActual` off
   * its own run and the runner's display truncates, so a prediction the actual
   * CONTAINS must match — but an actual the prediction contains must not, or a
   * one-word prediction would settle every failure of the step.
   */
  it('matches a prediction the actual contains, never the reverse', () => {
    expect(actualMatchesPrediction('exit 2 — unknown flag', 'exit 2')).toBe(true)
    expect(actualMatchesPrediction('exit 2', 'exit 2 — unknown flag')).toBe(false)
    // Whitespace is normalized on both sides, never the words.
    expect(actualMatchesPrediction('exit   2\n  — unknown flag', 'exit 2 — unknown')).toBe(true)
  })

  it('is silent on a NEAR-MISS red — declared at step 3, failed at step 2', () => {
    const near = item({
      expectedRed: EXPECTED_RED,
      row: failRow('scn.a', { failure: { step: 2, expected: 'exit 0', actual: 'exit 2 — unknown flag' } }),
      step: 2,
    })

    expect(deterministicVerdict(near)).toBeNull()
  })

  it('is silent when the actual is not the prediction', () => {
    const surprise = item({
      expectedRed: EXPECTED_RED,
      row: failRow('scn.a', { failure: { step: 3, expected: 'exit 0', actual: 'exit 137 — killed' } }),
      actual: 'exit 137 — killed',
    })

    expect(deterministicVerdict(surprise)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2 + 3. The runner's own sentinels
// ---------------------------------------------------------------------------

describe('deterministicVerdict — the runner’s detected states', () => {
  it('calls a failed setup capability a seed-defect the scenario layer owns', () => {
    const row = failRow('scn.setup', {
      outcome: 'error',
      failure: { step: 1, expected: CAPABILITY_SETUP_EXPECTED, actual: 'capability `git` is not registered' },
    })

    const auto = deterministicVerdict(item({ row, outcome: 'error', step: 1, expected: CAPABILITY_SETUP_EXPECTED, actual: 'capability `git` is not registered' }))

    expect(auto).not.toBeNull()
    expect(auto!.class).toBe('seed-defect')
    expect(auto!.fix).toEqual({ layer: 'scenario', description: 'capability `git` is not registered' })
  })

  it('calls an unserved route infrastructure, not a code verdict', () => {
    const row = failRow('scn.route', { unservedRoute: true })

    const auto = deterministicVerdict(item({ row }))

    expect(auto).not.toBeNull()
    expect(auto!.class).toBe('infrastructure')
    expect(auto!.mechanism).toContain('unserved route')
  })

  it('is silent on an ordinary red', () => {
    expect(deterministicVerdict(item())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The claim that matters: a self-explaining board costs no session
// ---------------------------------------------------------------------------

describe('runGuardAdjudication — a pre-passed board opens no session run', () => {
  it('settles from the stores alone and never creates `.truecourse/sessions/`', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))
    writeManifest(r, manifestWith([{ scenarioId: 'scn.a', flowId: 'flow.a', expectedRed: EXPECTED_RED }]))

    const run = await runGuardAdjudication({ repoRoot: r })

    expect(run.scenarios).toHaveLength(1)
    expect(run.scenarios[0]).toMatchObject({ scenarioId: 'scn.a', source: 'pre-pass' })
    expect(run.scenarios[0].verdict?.class).toBe('expected-red')
    // The verdict of a session-less run carries no session id, by contract.
    expect(run.scenarios[0].verdict?.sessionId).toBeUndefined()
    expect(run.sessionRunId).toBeUndefined()
    expect(run.usage.sessions.count).toBe(0)
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false)
    // The board carries the verdict afterwards — the fold's one serial write.
    const latest = JSON.parse(
      fs.readFileSync(path.join(r, '.truecourse', 'guard', 'LATEST.json'), 'utf-8'),
    )
    expect(latest.scenarios[0].adjudication.class).toBe('expected-red')
    expect(latest.run.runId).toBe(RUN_ID)
  })
})
