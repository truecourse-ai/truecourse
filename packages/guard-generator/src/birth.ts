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
 *
 * A run the runner REFUSES outright is none of those three: it is reported at the
 * RUN level and produces no scenario verdicts at all (see {@link BirthRound}).
 */

import { runFailureMessage, type GuardExecutor, type GuardRunStepStats, type Recipe } from '@truecourse/guard-runner'
import type {
  GuardDriverId,
  GuardFlow,
  GuardRunRefusal,
  GuardScenario,
  GuardScenarioResult,
} from '@truecourse/shared'
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

/**
 * One birth round: either the runner ran the candidates and produced an outcome per
 * candidate, or it REFUSED the whole run and produced none.
 *
 * The split exists because the two are not the same news. A refusal is a fact about
 * the WORLD (a recipe that doesn't parse, an external account configured half-way);
 * turning it into one synthetic failure per candidate manufactures N scenario
 * verdicts out of an inspection that read a single JSON file and never started the
 * app — and N identical "the scenario failed" lines are exactly what hides the one
 * line of config that caused them.
 */
export interface BirthRound {
  /** Set when the run was declined; `outcomes` is then empty by construction. */
  refusal?: GuardRunRefusal
  outcomes: BirthOutcome[]
  /**
   * The round's per-driver step aggregate (C4), when the runner ran and reported
   * one. The generator FOLDS these across its birth rounds and aborts as
   * `recipe-failed` when the cumulative sample says the recipe is a silent no-op
   * — see `detectNoOpAnomaly` in guard-runner. Absent on a refusal, a non-ok
   * status, or an executor that reports none.
   */
  stepStats?: GuardRunStepStats
}

/**
 * The runner statuses that mean THE RUN WAS DECLINED, not that anything failed.
 * All of them are decided from configuration — the recipe, the host env, the seeded
 * world — before (or independently of) any scenario executing, and all of them
 * reproduce identically on every re-run until that configuration changes.
 *
 * Deliberately NOT here: `build-failed`, `entry-preflight-failed`, `run-timed-out`
 * and `aborted`. Those are outcomes of actually trying, and the generator already
 * gives each its own settled treatment.
 */
const RUN_REFUSAL_STATUSES: ReadonlySet<string> = new Set([
  'no-recipe',
  'invalid-recipe',
  'missing-credential-env',
  'missing-external-env',
  'seed-failed',
  'credential-request-failed',
])

/** Whether a non-ok runner status is a run-level refusal (see {@link RUN_REFUSAL_STATUSES}). */
export function isRunRefusalStatus(status: string): boolean {
  return RUN_REFUSAL_STATUSES.has(status)
}

// Declared ABOVE their only reader: `birthRunTimeoutMs` is exported from the package
// index, so a caller that invokes it during module evaluation (a module-level const in
// an importing module) would hit the temporal dead zone and throw ReferenceError if
// these lived below the function.
const BIRTH_RUN_FLOOR_MS = 900_000
const BIRTH_RUN_PER_CANDIDATE_MS = 120_000

/**
 * The wall-clock backstop handed to the runner for one birth round: a floor plus
 * a per-candidate allowance, both far above what a round of `count` sandboxed
 * scenarios can legitimately take. It exists to break a run that stopped making
 * progress at all, so it must never be the thing that ends a real round.
 */
export function birthRunTimeoutMs(count: number): number {
  return BIRTH_RUN_FLOOR_MS + count * BIRTH_RUN_PER_CANDIDATE_MS
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
  /** No-op classification threshold for the anomaly gate (C4) — a test seam. */
  noOpThresholdMs?: number
  /** Overrides the {@link birthRunTimeoutMs} backstop for this round — a test seam. */
  runTimeoutMs?: number
  branch?: string | null
  commit?: string | null
  /** Forwarded to the runner: `build`/`run` phase transitions (the build runs once). */
  onPhase?: (phase: 'build' | 'run', total?: number) => void
  /** Forwarded to the runner: fires as each candidate settles, with the running count. */
  onScenarioSettled?: (done: number, total: number, result: GuardScenarioResult) => void
}

/**
 * Run every candidate once through the runner and pair each result back with its
 * candidate. A run-level REFUSAL returns no outcomes at all (see {@link BirthRound});
 * any other non-ok status — a failed build, a timeout — did happen to these
 * candidates and still turns each into an `error` outcome.
 */
export async function birthValidate(
  repoRoot: string,
  candidates: BirthCandidate[],
  opts: BirthOptions,
): Promise<BirthRound> {
  if (candidates.length === 0) return { outcomes: [] }

  const res = await opts.executor({
    checkoutDir: repoRoot,
    recipe: opts.recipe,
    scenarios: candidates.map((c) => c.scenario),
    persist: false,
    skipBuild: opts.skipBuild,
    noOpThresholdMs: opts.noOpThresholdMs,
    // Applied here, not at the call sites, so no round can be authored without it.
    runTimeoutMs: opts.runTimeoutMs ?? birthRunTimeoutMs(candidates.length),
    branch: opts.branch,
    commit: opts.commit,
    onPhase: opts.onPhase,
    onScenarioSettled: opts.onScenarioSettled,
  })

  if (res.status !== 'ok') {
    const message = runFailureMessage(res)
    if (isRunRefusalStatus(res.status)) {
      return {
        refusal: {
          status: res.status,
          message,
          flowIds: [...new Set(candidates.map((c) => c.flow.id))],
        },
        outcomes: [],
      }
    }
    // A synthetic result mirrors what the runner would have produced: the PRIMARY
    // bind (the result schema carries one section) plus the candidate's flow.
    return {
      outcomes: candidates.map((candidate) => ({
        candidate,
        result: syntheticResult(candidate, 'the scenario to run', message),
      })),
    }
  }

  const byId = new Map(res.latest.scenarios.map((r) => [r.id, r]))
  return {
    outcomes: candidates.map((candidate) => ({
      candidate,
      result:
        byId.get(candidate.scenario.id) ??
        syntheticResult(candidate, 'a run result', 'scenario was not executed'),
    })),
    ...(res.stepStats ? { stepStats: res.stepStats } : {}),
  }
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
