/**
 * The TEARDOWN channel — a cli scenario's `teardown:` steps restore host state the
 * sandbox cannot undo. On a green run they are ordinary, verdict-affecting steps
 * (continuous numbering after `steps`); on every other exit — a failure, an
 * infrastructure error, a cancellation — the runner still executes every
 * not-yet-reached teardown step BEST-EFFORT: recorded in evidence (`teardown` /
 * `teardownMiss` on the step record), never moving the settled verdict, surfacing
 * any miss as the result's `teardownIncomplete` annotation. The loader validates
 * teardown steps exactly like main steps (regex compile, capture chains,
 * milestone refs), under the same continuous numbering.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  loadScenarios,
  resolveEntry,
  runScenario,
  writeGuardClaims,
  type RunScenarioContext,
} from '@truecourse/guard-runner'
import { claimContentHash, type GuardClaimsFile } from '@truecourse/shared'
import type { StepObservation } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeSpecDoc, writeRecipe, writeScenario, scenario, FIXTURE_BIN } from './helpers.js'

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
    capturePassEvidence: true,
    ...overrides,
  }
}

/** The written evidence bundle's `invocation.json`, parsed. */
function invocation(r: string, evidencePath: string): { steps: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(path.join(r, evidencePath, 'invocation.json'), 'utf-8'))
}

describe('runScenario — teardown steps', () => {
  it('runs teardown as ordinary verdict-affecting steps on a green run, flagged in evidence', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'green',
        steps: [{ run: ['init'], expect: { exit: 0 } }],
        teardown: [
          { run: ['note', 'cleanup.txt', 'done'], expect: { exit: 0, files: { 'cleanup.txt': { exists: true } } } },
        ],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('pass')
    expect(res.teardownIncomplete).toBeUndefined()
    const steps = invocation(r, res.evidencePath!).steps
    expect(steps).toHaveLength(2)
    expect(steps[0].teardown).toBeUndefined()
    expect(steps[1].teardown).toBe(true)
    expect(steps[1].teardownMiss).toBeUndefined()
  })

  it('still executes teardown after a main-step FAILURE, without moving the verdict', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'fail-then-clean',
        steps: [{ run: ['boom'], expect: { exit: 0 } }],
        teardown: [{ run: ['note', 'cleanup.txt', 'done'], expect: { exit: 0 } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.step).toBe(1)
    // The teardown succeeded, so the annotation stays absent.
    expect(res.teardownIncomplete).toBeUndefined()
    const steps = invocation(r, res.evidencePath!).steps
    expect(steps).toHaveLength(2)
    expect(steps[1].teardown).toBe(true)
    expect(steps[1].exitCode).toBe(0)
    expect(steps[1].stdout).toContain('Noted')
  })

  it('annotates the result and the step record when a best-effort teardown step misses', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'fail-then-miss',
        steps: [{ run: ['boom'], expect: { exit: 0 } }],
        teardown: [{ run: ['boom'], expect: { exit: 0 } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    // The verdict is the MAIN step's, never the teardown's.
    expect(res.failure!.step).toBe(1)
    expect(res.failure!.actual).toContain('exit 7')
    expect(res.teardownIncomplete).toBe(true)
    const steps = invocation(r, res.evidencePath!).steps
    expect(steps[1].teardown).toBe(true)
    const miss = steps[1].teardownMiss as { expected: string; actual: string }
    expect(miss.expected).toContain('exit 0')
    expect(miss.actual).toContain('exit 7')
    // The transcript renders the miss as advisory, never as the verdict.
    const transcript = fs.readFileSync(path.join(r, res.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('(teardown)')
    expect(transcript).toContain('teardown expectation not met (advisory')
    expect(transcript).toContain('── mismatch (step 1)')
  })

  it('a teardown failure on a GREEN run is the verdict, and later teardown still runs best-effort', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'green-teardown-fails',
        steps: [{ run: ['init'], expect: { exit: 0 } }],
        teardown: [
          { run: ['boom'], expect: { exit: 0 } },
          { run: ['note', 'cleanup.txt', 'done'], expect: { exit: 0 } },
        ],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    // Continuous numbering: the failing teardown step is step 2 of 3.
    expect(res.failure!.step).toBe(2)
    // The remaining teardown step ran best-effort and succeeded — no annotation.
    expect(res.teardownIncomplete).toBeUndefined()
    const steps = invocation(r, res.evidencePath!).steps
    expect(steps).toHaveLength(3)
    expect(steps[2].teardown).toBe(true)
    expect(steps[2].exitCode).toBe(0)
  })

  it('still executes teardown after an INFRASTRUCTURE error (step timeout)', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({
        id: 'timeout-then-clean',
        steps: [{ run: ['hang'], expect: { exit: 0 } }],
        teardown: [{ run: ['note', 'cleanup.txt', 'done'], expect: { exit: 0 } }],
      }),
      ctxFor(r, { stepTimeoutMs: 500 }),
    )
    expect(res.outcome).toBe('error')
    expect(res.failure!.actual).toContain('timed out')
    expect(res.teardownIncomplete).toBeUndefined()
    const steps = invocation(r, res.evidencePath!).steps
    expect(steps).toHaveLength(2)
    expect(steps[1].teardown).toBe(true)
    expect(steps[1].exitCode).toBe(0)
  })

  it('still executes teardown when the run is CANCELLED mid-step', async () => {
    const r = repo()
    const controller = new AbortController()
    const observations: StepObservation[] = []
    setTimeout(() => controller.abort(), 300)
    const res = await runScenario(
      scenario({
        id: 'abort-then-clean',
        steps: [{ run: ['hang'], expect: { exit: 0 } }],
        teardown: [{ run: ['note', 'cleanup.txt', 'done'], expect: { exit: 0 } }],
      }),
      ctxFor(r, { signal: controller.signal, onStep: (o) => observations.push(o) }),
    )
    // The cancelled result keeps its evidence-free `error` shape…
    expect(res.outcome).toBe('error')
    expect(res.failure!.actual).toBe('run aborted')
    expect(res.evidencePath).toBeUndefined()
    // …but the teardown step DID run (the killed `hang` observes exit null; the
    // teardown `note` is the only invocation that can observe exit 0).
    expect(observations.some((o) => o.exitCode === 0 && !o.stdoutEmpty)).toBe(true)
  })
})

describe('scenario loader — teardown steps validate like main steps', () => {
  it('rejects an uncompilable regex in a teardown step, under continuous numbering', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'area/bad-teardown-regex.yaml',
      scenario({
        id: 'bad-teardown-regex',
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
        teardown: [{ run: ['--version'], expect: { stdout: { matches: '(' } } }],
      }),
    )
    const { errors } = loadScenarios(r)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('step 2')
    expect(errors[0].message).toContain('not a valid regular expression')
  })

  it('reports a teardown step reading a value no step captures', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'area/teardown-capture.yaml',
      scenario({
        id: 'teardown-capture',
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
        teardown: [{ run: ['note', '${captured:missing}', 'x'], expect: { exit: 0 } }],
      }),
    )
    const { errors } = loadScenarios(r)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('step 2 references ${captured:missing}')
  })

  it('resolves a teardown step milestone against the claims store', () => {
    const r = repo()
    writeRecipe(r)
    const body = { doc: 'docs/spec.md', anchor: 'a/b', title: 'it uninstalls', claim: 'It uninstalls.' }
    const claims: GuardClaimsFile = {
      version: 1,
      generatedAt: '2026-08-07T00:00:00.000Z',
      claims: [{ id: 'uninstall-claim', ...body, contentHash: claimContentHash(body) }],
      untestable: [],
    }
    writeGuardClaims(r, claims)
    writeScenario(
      r,
      'area/teardown-milestone.yaml',
      scenario({
        id: 'teardown-milestone',
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
        teardown: [
          { run: ['--version'], expect: { exit: 0 }, milestone: 'uninstall-claim' },
          { run: ['--version'], expect: { exit: 0 }, milestone: 'ghost-claim' },
        ],
      }),
    )
    const { errors, scenarios } = loadScenarios(r)
    // The resolvable teardown milestone passes; the dangling one is named by its
    // continuous step number, and the scenario is kept.
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('step 3 names milestone claim "ghost-claim"')
    expect(scenarios).toHaveLength(1)
  })
})
