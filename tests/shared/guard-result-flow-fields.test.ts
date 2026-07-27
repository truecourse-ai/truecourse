import { describe, it, expect } from 'vitest'
import { GuardLatestSchema, GuardScenarioResultSchema } from '../../packages/shared/src/guard/index'

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
})
