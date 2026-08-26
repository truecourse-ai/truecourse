/**
 * THE VISUAL JUDGE'S VERDICT, what a vision model saw in the screenshot a
 * FAILING web step left behind.
 *
 * It is an ANNOTATION and nothing else. The deterministic expectation is the only
 * thing that decides pass or fail (the determinism rule is not negotiable: a
 * model's opinion is not reproducible, so it can never move a verdict). What the
 * judge adds is the answer to the question a human asks first when a web step goes
 * red, "so what was actually on the screen?", which is otherwise only available
 * by opening a PNG out of a gitignored evidence directory.
 *
 * The most valuable verdict is `yes`: the expected result IS visible even though
 * the assertion missed, which is the signature of a brittle locator or matcher -
 * the test being wrong rather than the page. That is surfaced to the reader in
 * those words, and acted on by nobody automatically.
 */

import { z } from 'zod'

/**
 * Was the expected result visibly satisfied on screen? `unclear` is a real answer
 * and must stay available, a full-page screenshot of a long scroll, a modal
 * mid-animation, or an expectation about something invisible (an attribute, an
 * ARIA state) genuinely cannot be settled by looking, and a model forced to guess
 * would produce exactly the confident noise this annotation must not add.
 */
export const GuardVisualAnswerSchema = z.enum(['yes', 'no', 'unclear'])
export type GuardVisualAnswer = z.infer<typeof GuardVisualAnswerSchema>

/** The judge's full reply, what the transcript carries. */
export const GuardVisualJudgmentSchema = z
  .object({
    /** Whether the step's expected result is visibly satisfied in the screenshot. */
    expectedVisible: GuardVisualAnswerSchema,
    /** What IS on screen, relevant to the expectation, one or two sentences. */
    screenSummary: z.string().min(1),
    /** Why, including anything visibly broken (an error state, a blank region). */
    rationale: z.string().min(1),
  })
  .strict()
export type GuardVisualJudgment = z.infer<typeof GuardVisualJudgmentSchema>

/**
 * Cap on EACH field stored INLINE in `LATEST.json`, a guard against a runaway
 * reply, never a display budget. The reading renders WHOLE in the dashboard: a
 * verdict is a few sentences per field, and truncating it was tried (at 240) and
 * produced a note that trailed off exactly where it got useful. The board is
 * committable, so the ceiling exists only to keep a pathological reply from
 * bloating it.
 */
export const VISUAL_INLINE_LIMIT = 2000

/** The inline form a run result carries, see {@link VISUAL_INLINE_LIMIT}. */
export const GuardVisualAnnotationSchema = z
  .object({
    verdict: GuardVisualAnswerSchema,
    /** The judge's `screenSummary`, what is on screen. */
    summary: z.string(),
    /**
     * The judge's `rationale`, WHY the assertion missed against what is
     * visible, the half a reader actually acts on. Optional only for boards
     * written before the field existed; every newly judged failure carries it.
     */
    rationale: z.string().optional(),
  })
  .strict()
export type GuardVisualAnnotation = z.infer<typeof GuardVisualAnnotationSchema>

/** One inline field: whitespace-collapsed, whole unless pathologically long. */
function inline(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > VISUAL_INLINE_LIMIT
    ? `${collapsed.slice(0, VISUAL_INLINE_LIMIT - 1)}…`
    : collapsed
}

/** The inline annotation a result stores, the whole reading, both halves. */
export function visualAnnotation(judgment: GuardVisualJudgment): GuardVisualAnnotation {
  return {
    verdict: judgment.expectedVisible,
    summary: inline(judgment.screenSummary),
    rationale: inline(judgment.rationale),
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
        'the expected result APPEARS VISIBLE on the screenshot, the assertion itself may be ' +
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
    'visual-judge is an ANNOTATION, the deterministic expectation above decided this step.',
  ]
}
