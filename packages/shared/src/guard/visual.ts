/**
 * THE VISUAL JUDGE'S VERDICT — what a vision model saw in the screenshot a
 * FAILING web step left behind.
 *
 * It is an ANNOTATION and nothing else. The deterministic expectation is the only
 * thing that decides pass or fail (§10.2's determinism rule is not negotiable: a
 * model's opinion is not reproducible, so it can never move a verdict). What the
 * judge adds is the answer to the question a human asks first when a web step goes
 * red — "so what was actually on the screen?" — which is otherwise only available
 * by opening a PNG out of a gitignored evidence directory.
 *
 * The most valuable verdict is `yes`: the expected result IS visible even though
 * the assertion missed, which is the signature of a brittle locator or matcher —
 * the test being wrong rather than the page. That is surfaced to the reader in
 * those words, and acted on by nobody automatically.
 */

import { z } from 'zod'

/**
 * Was the expected result visibly satisfied on screen? `unclear` is a real answer
 * and must stay available — a full-page screenshot of a long scroll, a modal
 * mid-animation, or an expectation about something invisible (an attribute, an
 * ARIA state) genuinely cannot be settled by looking, and a model forced to guess
 * would produce exactly the confident noise this annotation must not add.
 */
export const GuardVisualAnswerSchema = z.enum(['yes', 'no', 'unclear'])
export type GuardVisualAnswer = z.infer<typeof GuardVisualAnswerSchema>

/** The judge's full reply — what the transcript carries. */
export const GuardVisualJudgmentSchema = z
  .object({
    /** Whether the step's expected result is visibly satisfied in the screenshot. */
    expectedVisible: GuardVisualAnswerSchema,
    /** What IS on screen, relevant to the expectation — one or two sentences. */
    screenSummary: z.string().min(1),
    /** Why, including anything visibly broken (an error state, a blank region). */
    rationale: z.string().min(1),
  })
  .strict()
export type GuardVisualJudgment = z.infer<typeof GuardVisualJudgmentSchema>

/**
 * Cap on the summary stored INLINE in `LATEST.json`. The board is committable and
 * read whole on every dashboard load, so it carries the verdict plus a glance —
 * the full rationale lives in the evidence transcript, where length is free.
 */
export const VISUAL_SUMMARY_LIMIT = 240

/** The compact form a run result carries — see {@link VISUAL_SUMMARY_LIMIT}. */
export const GuardVisualAnnotationSchema = z
  .object({
    verdict: GuardVisualAnswerSchema,
    /** The judge's `screenSummary`, truncated to {@link VISUAL_SUMMARY_LIMIT}. */
    summary: z.string(),
  })
  .strict()
export type GuardVisualAnnotation = z.infer<typeof GuardVisualAnnotationSchema>

/** Squeeze one judgment into the inline annotation a result stores. */
export function visualAnnotation(judgment: GuardVisualJudgment): GuardVisualAnnotation {
  const summary = judgment.screenSummary.replace(/\s+/g, ' ').trim()
  return {
    verdict: judgment.expectedVisible,
    summary:
      summary.length > VISUAL_SUMMARY_LIMIT ? `${summary.slice(0, VISUAL_SUMMARY_LIMIT - 1)}…` : summary,
  }
}

/** The verdict's headline, in the words the reader needs it in. */
function headline(answer: GuardVisualAnswer): string {
  switch (answer) {
    case 'no':
      return 'the expected result is NOT visible on the screenshot'
    case 'yes':
      // THE test-is-wrong signal. Said plainly, because a reader looking at a red
      // step needs to know the disagreement may be the assertion's, not the page's.
      return (
        'the expected result APPEARS VISIBLE on the screenshot — the assertion itself may be ' +
        'wrong (a brittle locator or matcher), not the page'
      )
    case 'unclear':
      return 'the screenshot does not settle whether the expected result is visible'
  }
}

/**
 * The lines a judged failure adds to the evidence transcript and `diff.txt`. Every
 * one is prefixed `visual-judge:` so a reader can tell at a glance which half of
 * the failure a machine measured and which half a model merely looked at.
 */
export function visualJudgeLines(judgment: GuardVisualJudgment): string[] {
  return [
    `visual-judge: ${headline(judgment.expectedVisible)}`,
    `visual-judge on screen: ${judgment.screenSummary}`,
    `visual-judge rationale: ${judgment.rationale}`,
    'visual-judge is an ANNOTATION — the deterministic expectation above decided this step.',
  ]
}
