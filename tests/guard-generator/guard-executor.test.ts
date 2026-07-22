/**
 * Birth validation runs through the injected `GuardExecutor` seam, not `runGuard`
 * directly. A fake executor proves the semantics birth relies on cross the seam:
 * the candidate scenarios, `persist: false` (never move the baseline), `skipBuild`
 * (reuse the generator's single build), and the injected recipe — and that the
 * report the executor returns is mapped back onto each candidate.
 */
import { describe, it, expect } from 'vitest'
import { birthValidate, type BirthCandidate } from '@truecourse/guard-generator'
import type { GuardExecInput, GuardExecReport, Recipe } from '@truecourse/guard-runner'
import {
  GUARD_FORMAT_VERSION,
  type GuardLatest,
  type GuardScenario,
  type GuardScenarioResult,
} from '@truecourse/shared'

const RECIPE: Recipe = { build: 'true', entry: ['node', 'bin.mjs'] }

function candidate(id: string): BirthCandidate {
  const binds = { doc: 'docs/cli.md', section: 'version', fingerprint: 'sha256:abc' }
  const scenario: GuardScenario = {
    guard: GUARD_FORMAT_VERSION,
    id,
    title: id,
    binds,
    driver: 'cli',
    steps: [{ run: ['--version'], expect: { exit: 0 } }],
    normalize: [],
  }
  return {
    section: {
      doc: 'docs/cli.md',
      anchor: 'version',
      fingerprint: 'sha256:abc',
      headingText: 'version',
      level: 2,
      ownText: '',
      fullText: '',
      areaTags: [],
    },
    scenario,
    ref: id,
    claim: { claim: 'c', driver: 'cli', sectionAnchor: 'version', reason: 'exit' },
  }
}

/** A fake executor that records its input and reports every scenario as a pass. */
function passingExecutor(sink: { input?: GuardExecInput }) {
  return async (input: GuardExecInput): Promise<GuardExecReport> => {
    sink.input = input
    const scenarios: GuardScenarioResult[] = input.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      binds: s.binds,
      outcome: 'pass',
      durationMs: 1,
    }))
    const latest: GuardLatest = {
      run: {
        runId: 'r',
        ranAt: new Date().toISOString(),
        branch: null,
        commit: null,
        recipeFingerprint: 'sha256:x',
        scenarioFormat: GUARD_FORMAT_VERSION,
      },
      summary: { total: scenarios.length, pass: scenarios.length, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios,
      sections: [],
    }
    return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null }
  }
}

describe('birthValidate through the executor seam', () => {
  it('passes candidates + persist:false + skipBuild + recipe through, and maps the report back', async () => {
    const sink: { input?: GuardExecInput } = {}
    const candidates = [candidate('version.1'), candidate('version.2')]

    const { outcomes } = await birthValidate('/repo', candidates, {
      executor: passingExecutor(sink),
      recipe: RECIPE,
      skipBuild: true,
    })

    // The seam saw exactly what birth relies on.
    expect(sink.input).toBeDefined()
    expect(sink.input!.checkoutDir).toBe('/repo')
    expect(sink.input!.persist).toBe(false)
    expect(sink.input!.skipBuild).toBe(true)
    expect(sink.input!.recipe).toBe(RECIPE)
    expect(sink.input!.scenarios.map((s) => s.id)).toEqual(['version.1', 'version.2'])

    // The report is mapped back onto each candidate.
    expect(outcomes).toHaveLength(2)
    expect(outcomes.every((o) => o.result.outcome === 'pass')).toBe(true)
    expect(outcomes.map((o) => o.candidate.ref)).toEqual(['version.1', 'version.2'])
  })

  it('does not invoke the executor for an empty candidate set', async () => {
    const sink: { input?: GuardExecInput } = {}
    const { outcomes, stepStats, anomaly } = await birthValidate('/repo', [], {
      executor: passingExecutor(sink),
      recipe: RECIPE,
    })
    expect(outcomes).toEqual([])
    expect(stepStats.executedSteps).toBe(0)
    expect(anomaly).toBeNull()
    expect(sink.input).toBeUndefined()
  })
})
