/**
 * THE VISUAL-JUDGE SEAM — the one hole this package leaves for an LLM, and the
 * reason it can stay LLM-FREE while a vision model still annotates its failures.
 *
 * Nothing here calls a model, imports one, or knows what one is. It is a callback
 * TYPE: `guard run` takes an optional judge, the runner invokes it at exactly one
 * moment, and `@truecourse/core` (which owns every transport) supplies the
 * implementation. Injected ⇒ failing web steps get annotated; absent ⇒ the runner
 * behaves precisely as it did before the judge existed, which is what keeps the
 * generator's birth validation, the test suite and any hosted executor free of a
 * model dependency they never asked for.
 *
 * THE CONTRACT, and it is deliberately narrow:
 *   - the judge is asked ONLY about a step that has ALREADY failed its
 *     deterministic expectation and left a screenshot behind;
 *   - its answer is an ANNOTATION. It cannot rescue a failing step and cannot fail
 *     a passing one — the deterministic check is the only thing that decides an
 *     outcome, because a model's opinion is not reproducible (§10.2);
 *   - it is FAIL-SOFT by construction: `null` means "no verdict", and a judge that
 *     throws is caught by the runner and treated the same way. A run must never
 *     get slower, redder or greener because a model was unavailable.
 */

import type { GuardVisualJudgment } from '@truecourse/shared'

/** What the judge is told about the failure it is looking at. */
export interface GuardVisualJudgeInput {
  /** Absolute path to the PNG the failing step left in the evidence directory. */
  screenshotPath: string
  /**
   * The step's HUMAN-level claim — its authoring note, else the claim identities of
   * the milestone it realizes. Absent on a step that carries neither. It is what
   * the step is FOR, which the mechanical expectation below never says.
   */
  claim?: string
  /** The step's expectation as the runner renders it — what was mechanically checked. */
  expectation: string
  /** The deterministic mismatch's `expected`, verbatim. */
  expected: string
  /** The deterministic mismatch's `actual`, verbatim. */
  actual: string
  /** 1-based index of the failing step. */
  stepIndex: number
  scenarioId: string
}

/**
 * The injected judge. Returns a verdict, or `null` for "no verdict" — which is the
 * honest answer whenever there is no transport, the call failed, the reply would
 * not validate, or the screenshot was too large to be worth sending.
 */
export type GuardVisualJudge = (input: GuardVisualJudgeInput) => Promise<GuardVisualJudgment | null>
