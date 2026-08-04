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
    surface: 'cli',
    // Only the id is read here (a refusal names the flows it cancelled).
    flow: { id: `flow-${id}` } as BirthCandidate['flow'],
  }
}

/**
 * A fake executor that REFUSES the run — the shape the runner returns when it
 * declines from configuration alone, having built, booted and executed nothing.
 */
function refusingExecutor(status: string, message: string) {
  return async (): Promise<GuardExecReport> => ({ status, message }) as unknown as GuardExecReport
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
    candidates[0].artifact = {
      scenario: candidates[0].scenario,
      source: {
        path: '.truecourse/scenarios/cli/version.1.yaml',
        content: 'guard: 2\nid: version.1\n',
      },
      companions: {
        '.truecourse/scenarios/cli/version.1.seed.mjs': 'export default true\n',
      },
    }

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
    expect(sink.input!.artifacts?.[0]).toEqual(candidates[0].artifact)

    // The report is mapped back onto each candidate.
    expect(outcomes).toHaveLength(2)
    expect(outcomes.every((o) => o.result.outcome === 'pass')).toBe(true)
    expect(outcomes.map((o) => o.candidate.ref)).toEqual(['version.1', 'version.2'])
  })

  it('does not invoke the executor for an empty candidate set', async () => {
    const sink: { input?: GuardExecInput } = {}
    const { outcomes } = await birthValidate('/repo', [], {
      executor: passingExecutor(sink),
      recipe: RECIPE,
    })
    expect(outcomes).toEqual([])
    expect(sink.input).toBeUndefined()
  })
})

/**
 * The defect this pins: a run-level refusal used to be fanned out into one synthetic
 * `error` outcome PER CANDIDATE, which the generator then wrote as N per-scenario
 * "birth validation error" entries. Nothing was validated — the refusal is decided
 * from config before anything runs — so there are no scenario verdicts to report.
 */
describe('birthValidate — a REFUSED run is not a set of scenario failures', () => {
  for (const status of ['missing-external-env', 'invalid-recipe'] as const) {
    it(`reports ${status} once, at the run level, with no per-candidate outcomes`, async () => {
      const candidates = [candidate('version.1'), candidate('version.2'), candidate('version.3')]
      const round = await birthValidate('/repo', candidates, {
        executor: refusingExecutor(status, 'external service hit-pay is only partly configured'),
        recipe: RECIPE,
      })

      expect(round.outcomes).toEqual([])
      expect(round.refusal?.status).toBe(status)
      expect(round.refusal?.message).toContain('hit-pay')
      // Named once each, so a flow surface can say what blocked IT.
      expect(round.refusal?.flowIds).toEqual(['flow-version.1', 'flow-version.2', 'flow-version.3'])
    })
  }

  it('still fans a non-refusal failure out per candidate — those candidates really were run', async () => {
    const candidates = [candidate('version.1'), candidate('version.2')]
    const round = await birthValidate('/repo', candidates, {
      executor: refusingExecutor('run-timed-out', 'timed out') as never,
      recipe: RECIPE,
    })

    expect(round.refusal).toBeUndefined()
    expect(round.outcomes).toHaveLength(2)
    expect(round.outcomes.every((o) => o.result.outcome === 'error')).toBe(true)
  })
})
