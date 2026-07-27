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

import { runFailureMessage, type GuardExecutor, type Recipe } from '@truecourse/guard-runner'
import type { GuardDriverId, GuardFlow, GuardScenario, GuardScenarioResult } from '@truecourse/shared'
import type { SectionInput } from './section-plan.js'

/**
 * A scenario awaiting birth validation, tagged with the (flow, surface) it
 * realizes so a failure can be re-authored with its evidence and attributed to the
 * flow. `section` is the flow's PRIMARY binding — the section a finding pivots on
 * when the failing step carries no milestone.
 */
export interface BirthCandidate {
  flow: GuardFlow
  surface: GuardDriverId
  section: SectionInput
  scenario: GuardScenario
  /** `<flow-id>\0<surface>` — the retry/persist grouping key. */
  ref: string
}

export interface BirthOutcome {
  candidate: BirthCandidate
  result: GuardScenarioResult
}

export interface BirthOptions {
  /**
   * The execution seam every candidate runs through (REQUIRED). The OSS default runs
   * in-process; EE swaps in a hosted executor. Threaded from `generateGuards`, which
   * resolves it from core's `getGuardExecutor()`.
   */
  executor: GuardExecutor
  /**
   * The recipe to build + run against (REQUIRED). The generate flow already has the
   * discovered/loaded recipe, so it's passed IN rather than re-read from disk.
   */
  recipe: Recipe
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
  opts: BirthOptions,
): Promise<BirthOutcome[]> {
  if (candidates.length === 0) return []

  const res = await opts.executor({
    checkoutDir: repoRoot,
    recipe: opts.recipe,
    scenarios: candidates.map((c) => c.scenario),
    persist: false,
    skipBuild: opts.skipBuild,
    branch: opts.branch,
    commit: opts.commit,
    onPhase: opts.onPhase,
    onScenarioSettled: opts.onScenarioSettled,
  })

  if (res.status !== 'ok') {
    const message = runFailureMessage(res)
    // A synthetic result mirrors what the runner would have produced: the PRIMARY
    // bind (the result schema carries one section) plus the candidate's flow.
    return candidates.map((candidate) => ({
      candidate,
      result: syntheticResult(candidate, 'the scenario to run', message),
    }))
  }

  const byId = new Map(res.latest.scenarios.map((r) => [r.id, r]))
  return candidates.map((candidate) => ({
    candidate,
    result:
      byId.get(candidate.scenario.id) ??
      syntheticResult(candidate, 'a run result', 'scenario was not executed'),
  }))
}

/** The `error` result for a candidate that never reached the runner. */
function syntheticResult(
  candidate: BirthCandidate,
  expected: string,
  actual: string,
): GuardScenarioResult {
  return {
    id: candidate.scenario.id,
    title: candidate.scenario.title,
    binds: candidate.scenario.binds[0],
    ...(candidate.scenario.flow ? { flowId: candidate.scenario.flow.id } : {}),
    outcome: 'error',
    durationMs: 0,
    failure: { step: 1, expected, actual },
  }
}
