/**
 * THE STEP-DRIVER SEAM — how a step gets taken.
 *
 * The driver belongs to the STEP, not to the scenario (§2, 2026-08-09), so the
 * runner must not know how any particular kind of step is taken. It walks the step
 * list, asks the REGISTRY which driver owns each step, and hands it over. What comes
 * back is one of four outcomes in a vocabulary that says nothing about browsers or
 * child processes — which is what lets a new surface land as a new module rather
 * than as another branch in the middle of the run loop.
 *
 * The division of labour is strict:
 *   - a DRIVER takes the step and reports what happened, in this vocabulary. It
 *     writes its own transcript records (only it knows what its step did) and
 *     publishes anything the step captured.
 *   - the RUNNER owns everything about the scenario as a whole: the sandbox, token
 *     resolution, the evidence bundle, milestone attribution, and the verdict.
 * Nothing in a driver reaches for the run's result shape, and nothing in the runner
 * branches on a step kind.
 */

import type { GuardExpect, GuardFileExpect, GuardSandboxStep, OutputExcerpts } from '@truecourse/shared'
import type { Sandbox } from '../sandbox.js'
import type { EvidenceStep } from '../evidence.js'
import type { ExpectMismatch } from '../expect.js'
import type { StepObservation } from '../step-stats.js'
import type { WorldCredential } from '../web/credential.js'

/**
 * WHAT HAPPENED to one step, in the only four shapes a verdict is made of. Every
 * outcome carries the transcript `records` the step produced (a `repeat` step
 * produces one; a step that could not run at all still produces the record of what
 * it meant to do), because a transcript that stops before the failing step is a
 * transcript missing the interesting part.
 */
export type StepOutcome =
  /** The step did what it said and its expectation held. */
  | { status: 'ok'; records: EvidenceStep[] }
  /** An expectation was not met — the drift a scenario exists to find. */
  | {
      status: 'fail'
      records: EvidenceStep[]
      mismatch: ExpectMismatch
      /** What the step produced, for the failure line (a cli stream, a page's text). */
      excerpts?: OutputExcerpts
      /**
       * The VISUAL artifact this failure left behind, when the surface has one — a
       * screenshot, with the step's expectation in words. Supplied by the driver
       * (only it knows whether its surface can be looked at) and consumed by the
       * runner's optional visual judge. The runner never asks what KIND of step it
       * was: the presence of this field IS the answer, which is what keeps §2's
       * "nothing in the runner branches on a step kind" intact.
       */
      visual?: {
        /** Absolute path to the artifact — it lives in the scenario's evidence dir. */
        screenshotPath: string
        /** The step's expectation, one line, as the transcript renders it. */
        expectation: string
      }
    }
  /**
   * The step could not be taken. INFRASTRUCTURE, never a verdict about the app:
   * `expected` is the sentinel the result carries (the runner's `failure.expected`),
   * `message` is what actually went wrong.
   */
  | { status: 'error'; records: EvidenceStep[]; expected: string; message: string }
  /** The run was cancelled mid-step; the result is discarded, so nothing is written. */
  | { status: 'aborted' }

/**
 * Everything a driver may need from the scenario it is running in — and nothing
 * more. Every token-resolving function here is the SAME closure every driver uses,
 * which is what guarantees `${captured:…}` means one thing across surfaces.
 */
export interface StepRunContext {
  /** 1-based position of the step being taken. */
  stepIndex: number
  /** The scenario's sandbox: its cwd, its constructed env, its supplied instances. */
  sandbox: Sandbox
  repoRoot: string
  runId: string
  scenarioId: string
  /**
   * Where a driver writes artifacts that are not text — a screenshot, a video. The
   * scenario's evidence directory, created on demand.
   */
  evidenceDir: string
  /** Resolve `${unique}` / `${supplied:…}` / `${sandbox}` / `${captured:…}` in one string. */
  tok(text: string): string
  /** The same resolution across a cli expectation — matcher values and `files` keys. */
  resolveExpect<E extends GuardExpect | GuardFileExpect>(expect: E): E
  /** The same resolution across an env overlay's VALUES (the names are literal). */
  resolveEnv(env: Record<string, string>): Record<string, string>
  /** Apply the scenario's normalizers (used for stream and file comparison). */
  normText(text: string): string
  /** Publish what this step captured, for the steps after it. */
  publishCaptures(values: Record<string, string>): void
  /** The run's default per-step budget; a step's own `timeoutMs` wins over it. */
  stepTimeoutMs: number
  /**
   * The prepared world's credentials — declared by the recipe or minted by the
   * seed — by name, for the drivers that can present one (a web `credential`
   * step). Absent when the run prepared none.
   */
  credentials?: ReadonlyMap<string, WorldCredential>
  /** Run-level cancellation. */
  signal?: AbortSignal
  /** Per-invocation observation the runner folds into the no-op anomaly stats. */
  onStep?: (observation: StepObservation) => void
}

/**
 * One surface's step executor. `owns` is how the registry routes — it asks the
 * DRIVER whether a step is its own rather than the runner asking what kind of step
 * it is, so adding a surface never edits the router.
 *
 * `close` is the driver's teardown for THIS scenario, called exactly once whichever
 * way the scenario ended. A driver that opened nothing does nothing.
 */
export interface StepDriver {
  /** The surface this driver acts on — the word a step list and a chip both use. */
  readonly id: 'cli' | 'web' | 'api'
  /** True when this driver is the one that takes the step. */
  owns(step: GuardSandboxStep): boolean
  execute(step: GuardSandboxStep, ctx: StepRunContext): Promise<StepOutcome>
  close(): Promise<void>
}
