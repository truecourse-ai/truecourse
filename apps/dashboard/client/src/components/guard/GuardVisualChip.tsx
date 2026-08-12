/**
 * WHAT THE SCREENSHOT LOOKED LIKE — a vision model's reading of the picture a
 * failing web step left behind, worn beside the failure as a chip:
 *
 *   looks present   the expected result IS visible even though the assertion
 *                   missed — the signature of a brittle locator or matcher, the
 *                   one verdict that changes the reader's next action;
 *   looks absent    the page really does show something else — the model merely
 *                   corroborates the red the status already wears;
 *   looks unclear   the screenshot does not settle it — an honest shrug, kept
 *                   available so the model is never forced to guess.
 *
 * It is an ANNOTATION, never a status: the deterministic expectation alone
 * decided the step, so the chip speaks in "looks", not "is". The colour follows
 * the guard palette (red / green / blue / grey; amber is banned — see the sweep
 * in guard-vocabulary) — sky for "the red may be the assertion's own fault",
 * the same news-not-blame blue that took BLOCKED, and muted for the two verdicts
 * that add description without changing blame. Red is reserved for measured
 * drift and never given to an opinion.
 *
 * The hover carries the reading itself — what was on the screen — plus the one
 * caveat sentence. The failing step's inspector renders the same reading in
 * place; the chip is the glance, the inspector is the read.
 */

import type { GuardVisualAnnotation, GuardVisualAnswer } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';

const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';

/** The two words each verdict wears — an appearance, never a measurement. */
export const GUARD_VISUAL_WORD: Record<GuardVisualAnswer, string> = {
  yes: 'looks present',
  no: 'looks absent',
  unclear: 'looks unclear',
};

const TONE: Record<GuardVisualAnswer, string> = {
  yes: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  no: 'bg-muted text-muted-foreground',
  unclear: 'bg-muted text-muted-foreground',
};

/** What each verdict MEANS for the reader — the hover's second line. */
const CAVEAT: Record<GuardVisualAnswer, string> = {
  yes:
    'The expected result appears visible on the screenshot, so the assertion itself may be ' +
    'wrong — a brittle locator or matcher — rather than the page.',
  no: 'The expected result is not visible on the screenshot — the page really shows something else.',
  unclear: 'The screenshot does not settle whether the expected result is visible.',
};

export function GuardVisualChip({
  visual,
  className = '',
}: {
  visual: GuardVisualAnnotation;
  className?: string;
}) {
  return (
    <HoverPopover
      portal
      width="wide"
      content={
        <div className="space-y-1.5">
          <p>{visual.summary}</p>
          <p className="text-muted-foreground">{CAVEAT[visual.verdict]}</p>
          <p className="text-muted-foreground">
            A vision model read the failing step’s screenshot; the deterministic expectation alone
            decided the step.
          </p>
        </div>
      }
    >
      <span className={`${CHIP} ${TONE[visual.verdict]} ${className}`}>
        {GUARD_VISUAL_WORD[visual.verdict]}
      </span>
    </HoverPopover>
  );
}
