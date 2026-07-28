import { describe, it, expect } from 'vitest'
import {
  GuardLatestSchema,
  GuardScenarioResultSchema,
  blockedPreconditionAnnotation,
} from '../../packages/shared/src/guard/index'

// A run result gained three optional flow-era annotations — `flowId`, the failing
// step's `failedMilestone`, and the `journeyDrifted` dot. All optional, so runs
// stored before flows existed keep parsing.

const binds = { doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }

describe('GuardScenarioResultSchema — flow annotations', () => {
  it('parses a result carrying flowId, failedMilestone and the drift dot', () => {
    const parsed = GuardScenarioResultSchema.parse({
      id: 'publish.cli.1',
      title: 'publishes a release',
      binds,
      outcome: 'fail',
      durationMs: 12,
      failure: { step: 2, expected: 'exit 0', actual: 'exit 1' },
      flowId: 'publish',
      failedMilestone: 2,
      journeyDrifted: true,
    })
    expect(parsed).toMatchObject({ flowId: 'publish', failedMilestone: 2, journeyDrifted: true })
  })

  it('parses a result from before flows existed (the fields stay absent)', () => {
    const parsed = GuardScenarioResultSchema.parse({
      id: 's1',
      title: 't',
      binds,
      outcome: 'pass',
      durationMs: 3,
    })
    expect(parsed.flowId).toBeUndefined()
    expect(parsed.failedMilestone).toBeUndefined()
    expect(parsed.journeyDrifted).toBeUndefined()
  })

  it('rejects a non-positive milestone', () => {
    const bad = { id: 's1', title: 't', binds, outcome: 'fail', durationMs: 1, failedMilestone: 0 }
    expect(GuardScenarioResultSchema.safeParse(bad).success).toBe(false)
  })

  it('rides through LATEST', () => {
    const latest = GuardLatestSchema.parse({
      run: {
        runId: '2026-07-24T00-00-00Z_abcd1234',
        ranAt: '2026-07-24T00:00:00.000Z',
        branch: null,
        commit: null,
        recipeFingerprint: 'sha256:r',
        scenarioFormat: 2,
      },
      summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0 },
      scenarios: [
        {
          id: 'publish.cli.1',
          title: 'publishes a release',
          binds,
          outcome: 'fail',
          durationMs: 12,
          flowId: 'publish',
          failedMilestone: 3,
          journeyDrifted: true,
        },
      ],
      sections: [{ doc: 'docs/spec.md', section: 'a/b', status: 'fail', scenarioIds: ['publish.cli.1'] }],
    })
    expect(latest.scenarios[0]).toMatchObject({ flowId: 'publish', failedMilestone: 3, journeyDrifted: true })
  })

  // Item 60 (Phase 6): a fourth annotation, same shape — optional, never an outcome.
  it('parses the blocked-precondition annotation and leaves it absent when unset', () => {
    const base = { id: 's1', title: 't', binds, outcome: 'fail' as const, durationMs: 1 }
    expect(GuardScenarioResultSchema.parse({ ...base, blockedPrecondition: true })).toMatchObject({
      outcome: 'fail',
      blockedPrecondition: true,
    })
    expect(GuardScenarioResultSchema.parse(base).blockedPrecondition).toBeUndefined()
  })
})

describe('blockedPreconditionAnnotation — the ONE rule both drivers spread', () => {
  const steps = [{}, { milestone: 1 }, { milestone: 2 }]

  it('annotates a failure on an unmilestoned step of a milestoned scenario', () => {
    expect(blockedPreconditionAnnotation(steps, 1)).toEqual({ blockedPrecondition: true })
  })

  it('says nothing when the failing step realizes a milestone', () => {
    expect(blockedPreconditionAnnotation(steps, 2)).toEqual({})
    expect(blockedPreconditionAnnotation(steps, 3)).toEqual({})
  })

  it('says nothing when the scenario declares no milestone at all', () => {
    // A hand-written test asserts THROUGH its plumbing — the failure IS its verdict.
    expect(blockedPreconditionAnnotation([{}, {}], 1)).toEqual({})
  })

  it('says nothing about a step index the scenario does not have', () => {
    expect(blockedPreconditionAnnotation(steps, 9)).toEqual({})
  })
})
