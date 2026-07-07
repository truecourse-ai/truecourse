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

import { runGuard } from '@truecourse/guard-runner'
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
}

/**
 * Run every candidate once through the runner and pair each result back with its
 * candidate. A build failure turns every candidate into an `error` outcome (infra
 * — no scenario could run), matching how the runner treats a broken recipe.
 */
export async function birthValidate(
  repoRoot: string,
  candidates: BirthCandidate[],
  opts: BirthOptions = {},
): Promise<BirthOutcome[]> {
  if (candidates.length === 0) return []

  const res = await runGuard({
    repoRoot,
    scenarios: candidates.map((c) => c.scenario),
    persist: false,
    skipBuild: opts.skipBuild,
    branch: opts.branch,
    commit: opts.commit,
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
    return candidates.map((candidate) => ({
      candidate,
      result: {
        id: candidate.scenario.id,
        title: candidate.scenario.title,
        binds: candidate.scenario.binds,
        outcome: 'error',
        durationMs: 0,
        failure: { step: 1, expected: 'the scenario to run', actual: message },
      },
    }))
  }

  const byId = new Map(res.latest.scenarios.map((r) => [r.id, r]))
  return candidates.map((candidate) => ({
    candidate,
    result:
      byId.get(candidate.scenario.id) ?? {
        id: candidate.scenario.id,
        title: candidate.scenario.title,
        binds: candidate.scenario.binds,
        outcome: 'error',
        durationMs: 0,
        failure: { step: 1, expected: 'a run result', actual: 'scenario was not executed' },
      },
  }))
}
