import { describe, it, expect } from 'vitest'
import {
  GuardHistoryEntrySchema,
  GuardLatestSchema,
  GuardRunEnvelopeSchema,
  GuardScenarioResultSchema,
  blockedPreconditionAnnotation,
  guardHistoryEntryOf,
} from '../../packages/shared/src/guard/index'

// A run result gained three optional flow-era annotations — `flowId`, the failing
// step's `failedMilestone`, and the `interfaceDrifted` dot. All optional, so runs
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
      interfaceDrifted: true,
    })
    expect(parsed).toMatchObject({ flowId: 'publish', failedMilestone: 2, interfaceDrifted: true })
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
    expect(parsed.interfaceDrifted).toBeUndefined()
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
          interfaceDrifted: true,
        },
      ],
      sections: [{ doc: 'docs/spec.md', section: 'a/b', status: 'fail', scenarioIds: ['publish.cli.1'] }],
    })
    expect(latest.scenarios[0]).toMatchObject({ flowId: 'publish', failedMilestone: 3, interfaceDrifted: true })
  })

  // A fourth annotation, same shape as the others — optional, never an outcome.
  it('parses the blocked-precondition annotation and leaves it absent when unset', () => {
    const base = { id: 's1', title: 't', binds, outcome: 'fail' as const, durationMs: 1 }
    expect(GuardScenarioResultSchema.parse({ ...base, blockedPrecondition: true })).toMatchObject({
      outcome: 'fail',
      blockedPrecondition: true,
    })
    expect(GuardScenarioResultSchema.parse(base).blockedPrecondition).toBeUndefined()
  })
})

// The envelope's provenance: which pull request a run gated and where it ran.
// Both optional, so every run stored before them keeps parsing, and both ride
// the history row so a run list needs no snapshot read.
describe('run provenance — pullRequest and origin', () => {
  const envelope = {
    runId: '2026-07-24T00-00-00Z_abcd1234',
    ranAt: '2026-07-24T00:00:00.000Z',
    branch: 'feature',
    commit: 'head1',
    recipeFingerprint: 'sha256:r',
  }
  const summary = { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 }

  it('parses an envelope and a history entry carrying both, and leaves them absent when unset', () => {
    const stamped = { ...envelope, pullRequest: 7, origin: 'hosted' }
    expect(GuardRunEnvelopeSchema.parse(stamped)).toMatchObject({ pullRequest: 7, origin: 'hosted' })
    const { recipeFingerprint: _fingerprint, ...identity } = stamped
    expect(GuardHistoryEntrySchema.parse({ ...identity, summary })).toMatchObject({
      pullRequest: 7,
      origin: 'hosted',
    })
    const plain = GuardRunEnvelopeSchema.parse(envelope)
    expect(plain.pullRequest).toBeUndefined()
    expect(plain.origin).toBeUndefined()
  })

  it('rejects an origin outside the two runners and a non-positive pull request', () => {
    expect(GuardRunEnvelopeSchema.safeParse({ ...envelope, origin: 'ci' }).success).toBe(false)
    expect(GuardRunEnvelopeSchema.safeParse({ ...envelope, pullRequest: 0 }).success).toBe(false)
  })

  it('guardHistoryEntryOf carries the provenance and only the provenance that is set', () => {
    const latest = (run: Record<string, unknown>) =>
      GuardLatestSchema.parse({ run, summary, scenarios: [], sections: [] })
    const stamped = latest({ ...envelope, pullRequest: 7, origin: 'hosted' })
    expect(guardHistoryEntryOf(stamped)).toEqual({
      runId: envelope.runId,
      ranAt: envelope.ranAt,
      branch: 'feature',
      commit: 'head1',
      summary: stamped.summary,
      pullRequest: 7,
      origin: 'hosted',
    })
    const bare = guardHistoryEntryOf(latest(envelope))
    expect('pullRequest' in bare).toBe(false)
    expect('origin' in bare).toBe(false)
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
