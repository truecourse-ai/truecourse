// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/guard/adjudication.ts; delete with the preview.
/**
 * RUN ADJUDICATION, the verdict `truecourse guard adjudicate` attaches to one
 * failing scenario of a guard run (plan 05, steps 21–23). The corpus runs'
 * largest recurring hand cost was reading every failure's transcript before
 * classifying it; the adjudication session does that read and ends with THIS
 * shape, and the deterministic pre-pass produces the same shape without a
 * session when the failure explains itself (a declared expected-red, a setup
 * defect, an unserved route).
 *
 * The verdict CLASSES, and what each routes to (see the fold in
 * `@truecourse/core`'s guard-adjudicate service):
 *  - `expected-red`    , the failure IS the committed red the flow worker
 *                         declared (`expectedReds`, plan 04 §17): the doc and
 *                         the code disagree exactly as predicted. Recorded;
 *                         nothing to do until one of them moves.
 *  - `drift`           , the doc and the code disagree in a way nothing
 *                         predicted. Stands red; feeds the findings report.
 *  - `bug`             , the CODE is wrong: a mechanism with a `file:line`,
 *                         and (at ≥ medium confidence) a control experiment
 *                         that tried to disprove it. Stands red; feeds the
 *                         findings report.
 *  - `authoring-defect`, the SCENARIO is wrong (a mis-authored assertion, a
 *                         bad step). Taints the flow in the auto-resolutions
 *                         ledger (source `adjudicate`) so the next generate
 *                         re-authors it fresh; a high-confidence claim-level
 *                         one may auto-dismiss the claim.
 *  - `seed-defect`     , the seeded world (or the scenario's own `setup`
 *                         declaration) failed before the behavior under test
 *                         was reached. Recorded, surfaced in `guard status`.
 *  - `infrastructure`  , nothing about the repo is in dispute: a refused run,
 *                         an unserved route, a dead sandbox. Recorded,
 *                         surfaced in `guard status`.
 *
 * The schema is also the SESSION OUTCOME of `guard-adjudicate.failure`, so it
 * obeys the outcome-schema rules: ONE strict object at the root (a root union
 * renders as `anyOf`, which the drivers' provider surfaces reject) and NO
 * `.default()` fields (`SessionDef.outcomeSchema` is `z.ZodType<T>`, which pins
 * schema Input ≡ Output), `findings` is therefore a REQUIRED array.
 */

import { z } from 'zod'

export const GuardAdjudicationClassSchema = z.enum([
  'expected-red',
  'drift',
  'bug',
  'authoring-defect',
  'seed-defect',
  'infrastructure',
])
export type GuardAdjudicationClass = z.infer<typeof GuardAdjudicationClassSchema>

/**
 * The control experiment's record on a `bug` verdict (plan 05 step 22): what
 * the independent control child concluded, why, and which control run the
 * conclusion came from. `transcriptRef` is the ENGINE-minted reference the
 * `verify_bug` tool named on dispatch, the fold refuses a fresh outcome whose
 * ref matches no control the engine actually ran, so a model cannot invent one.
 * (The child's own session id is not returned by `dispatchChild`; the parent
 * transcript's `child-session` event carries it for a reader following the ref.)
 */
export const GuardAdjudicationControlSchema = z
  .object({
    conclusion: z.enum(['confirms', 'refutes', 'inconclusive']),
    reasoning: z.string().min(1),
    /** The engine-minted control reference the acceptance named, verbatim. */
    transcriptRef: z.string().min(1),
  })
  .strict()
export type GuardAdjudicationControl = z.infer<typeof GuardAdjudicationControlSchema>

/** The concrete fix an `authoring-defect` / `seed-defect` verdict names. */
export const GuardAdjudicationFixSchema = z
  .object({
    /** Which layer is wrong: the scenario's own steps/asserts, the seed, or the recipe. */
    layer: z.enum(['scenario', 'seed', 'recipe']),
    description: z.string().min(1),
  })
  .strict()
export type GuardAdjudicationFix = z.infer<typeof GuardAdjudicationFixSchema>

export const GuardAdjudicationSchema = z
  .object({
    class: GuardAdjudicationClassSchema,
    /** The failure's mechanism, in plain words, WHAT goes wrong and WHY. */
    mechanism: z.string().min(1),
    /** For `bug`: where the mechanism lives. Fold-enforced (`bug` requires it). */
    code: z
      .object({ file: z.string().min(1), line: z.number().int().positive() })
      .strict()
      .optional(),
    /** Verbatim quotes from the evidence files that ground the verdict. */
    evidence: z.array(z.string().min(1)).min(1),
    /** The control experiment (step 22). Fold-enforced: `bug` at ≥ medium
     *  confidence requires one, and a `refutes` conclusion forbids `bug`. */
    control: GuardAdjudicationControlSchema.optional(),
    /** Fold-enforced: `authoring-defect` and `seed-defect` require it. */
    fix: GuardAdjudicationFixSchema.optional(),
    confidence: z.enum(['low', 'medium', 'high']),
    /**
     * Code-vs-docs/derivation discrepancies read en route, the doc-bug feed,
     * appended to the committable `guard/adjudicate.findings.md` ledger.
     * Distinct from `evidence` (which grounds THIS verdict). REQUIRED (empty
     * array when none): a session outcome schema may not carry `.default()`.
     */
    findings: z.array(z.string()),
  })
  .strict()
export type GuardAdjudication = z.infer<typeof GuardAdjudicationSchema>

/**
 * The PERSISTED verdict a scenario row carries, the adjudication plus when it
 * was reached and (when a session reached it) which session. A deterministic
 * pre-pass verdict and a cache-served one carry no `sessionId`: the pre-pass
 * ran no session, and the cache stores the output alone (the envelope, spend,
 * session identity, is a fact about the run that produced it, not the inputs).
 */
export const GuardScenarioAdjudicationSchema = GuardAdjudicationSchema.extend({
  /** ISO timestamp the verdict was recorded. */
  adjudicatedAt: z.string(),
  /** The `guard-adjudicate.failure` session that produced it, when one did. */
  sessionId: z.string().optional(),
})
export type GuardScenarioAdjudication = z.infer<typeof GuardScenarioAdjudicationSchema>
