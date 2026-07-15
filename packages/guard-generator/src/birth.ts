/**
 * Birth validation — the deterministic gate every freshly-authored scenario must
 * pass before it is committed. It runs the candidates through the guard runner
 * (building once), IN MEMORY: nothing is written to the corpus and the run store
 * is not touched (`persist: false`), so a scenario that fails at birth is never
 * persisted as a red guard.
 *
 * A `pass` means the scenario agrees with current code — the green-at-birth
 * baseline. A `fail` is either a generation defect (retry once with the evidence)
 * or real existing drift (a birth finding for the user); an `error` is infra and
 * is surfaced as-is, never retried.
 */

import { runGuard, type GuardRunStepStats, type GuardNoOpAnomaly } from '@truecourse/guard-runner'
import type { GuardScenario, GuardScenarioResult } from '@truecourse/shared'
import type { ExtractedClaim } from './schemas.js'
import type { SectionInput } from './section-plan.js'

/** A scenario awaiting birth validation, tagged with the claim it came from so a
 *  failure can be regenerated per-claim (with its evidence). */
export interface BirthCandidate {
  section: SectionInput
  scenario: GuardScenario
  /** The authoring ref of the claim this scenario asserts (retry grouping key). */
  ref: string
  /** The claim this scenario asserts. */
  claim: ExtractedClaim
}

export interface BirthOutcome {
  candidate: BirthCandidate
  result: GuardScenarioResult
}

export interface BirthOptions {
  /** Reuse the prior round's build (the working tree hasn't changed between rounds). */
  skipBuild?: boolean
  branch?: string | null
  commit?: string | null
  /** Forwarded to the runner: `build`/`run` phase transitions (the build runs once). */
  onPhase?: (phase: 'build' | 'run', total?: number) => void
  /** Forwarded to the runner: fires as each candidate settles, with the running count. */
  onScenarioSettled?: (done: number, total: number, result: GuardScenarioResult) => void
  /** Forwarded to the runner — the no-op step threshold (a test seam). */
  noOpThresholdMs?: number
}

/**
 * A birth round's outcomes plus the runner's step aggregate. The generator sums
 * `stepStats` across round-1 births to detect a do-nothing recipe entry before the
 * retry/fidelity rounds spend more LLM calls. A build failure yields zero stats.
 */
export interface BirthResult {
  outcomes: BirthOutcome[]
  /** The runner's per-run step aggregate (executed vs no-op), zero on a failed run. */
  stepStats: GuardRunStepStats
  /** The runner's no-op anomaly for THIS round alone (null when under threshold). */
  anomaly: GuardNoOpAnomaly | null
}

const ZERO_STEP_STATS: GuardRunStepStats = { executedSteps: 0, noOpSteps: 0, thresholdMs: 0 }

/**
 * Run every candidate once through the runner and pair each result back with its
 * candidate. A build failure turns every candidate into an `error` outcome (infra
 * — no scenario could run), matching how the runner treats a broken recipe.
 */
export async function birthValidate(
  repoRoot: string,
  candidates: BirthCandidate[],
  opts: BirthOptions = {},
): Promise<BirthResult> {
  if (candidates.length === 0) return { outcomes: [], stepStats: { ...ZERO_STEP_STATS }, anomaly: null }

  const res = await runGuard({
    repoRoot,
    scenarios: candidates.map((c) => c.scenario),
    persist: false,
    skipBuild: opts.skipBuild,
    branch: opts.branch,
    commit: opts.commit,
    noOpThresholdMs: opts.noOpThresholdMs,
    onPhase: opts.onPhase,
    onScenarioSettled: opts.onScenarioSettled,
  })

  if (res.status !== 'ok') {
    const message =
      res.status === 'build-failed'
        ? `build failed (\`${res.build.command}\`)${res.build.timedOut ? ' — timed out' : ''}`
        : res.status === 'invalid-recipe'
          ? res.message
          : 'no runnable recipe'
    return {
      outcomes: candidates.map((candidate) => ({
        candidate,
        result: {
          id: candidate.scenario.id,
          title: candidate.scenario.title,
          binds: candidate.scenario.binds,
          outcome: 'error',
          durationMs: 0,
          failure: { step: 1, expected: 'the scenario to run', actual: message },
        },
      })),
      stepStats: { ...ZERO_STEP_STATS },
      anomaly: null,
    }
  }

  const byId = new Map(res.latest.scenarios.map((r) => [r.id, r]))
  const outcomes = candidates.map((candidate) => ({
    candidate,
    result:
      byId.get(candidate.scenario.id) ?? {
        id: candidate.scenario.id,
        title: candidate.scenario.title,
        binds: candidate.scenario.binds,
        outcome: 'error' as const,
        durationMs: 0,
        failure: { step: 1, expected: 'a run result', actual: 'scenario was not executed' },
      },
  }))
  return { outcomes, stepStats: res.stepStats, anomaly: res.anomaly }
}
