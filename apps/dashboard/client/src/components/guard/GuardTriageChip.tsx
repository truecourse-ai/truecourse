/**
 * The TRIAGE verdict beside a failure — what the failure actually IS, in one word:
 *
 *   code drift  the doc's promise is the contract and the program violates it;
 *   doc drift   the program is fine and the section says something untrue;
 *   our defect  the scenario itself was faulty — nothing about the repo is wrong.
 *
 * It is a chip, not a status: the test is failing either way, and this says WHOSE
 * fault that is. So the two drift verdicts take the failure's own colour (they are
 * real work in the repo) while a generation defect is muted — the same rule the
 * flow-level tool-defect marker follows.
 *
 * The hover carries the BRIEF — why the verdict is what it is. The concrete unblock
 * is deliberately NOT here: the verdict card renders it as its own visible line, and
 * a fact told twice reads as two facts.
 */

import type { GuardTriage, GuardTriageVerdict } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';

const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';

/** The one word each verdict wears — plain words, never the wire id. */
export const GUARD_TRIAGE_WORD: Record<GuardTriageVerdict, string> = {
  'code-drift': 'code drift',
  'doc-drift': 'doc drift',
  'generation-defect': 'our defect',
};

/**
 * Drift is the repo's — BOTH kinds take the failure colour, because both are real
 * work someone must do (fix the code, or fix the doc). Our defect stays muted:
 * rendering our own mistake in red reports a broken repo where nothing is broken.
 * Which drift it is, is the WORD's job — there is no third severity colour.
 */
const TONE: Record<GuardTriageVerdict, string> = {
  'code-drift': 'bg-red-500/10 text-red-600 dark:text-red-400',
  'doc-drift': 'bg-red-500/10 text-red-600 dark:text-red-400',
  'generation-defect': 'bg-muted text-muted-foreground',
};

export function GuardTriageChip({ triage, className = '' }: { triage: GuardTriage; className?: string }) {
  return (
    <HoverPopover
      portal
      width="wide"
      content={
        <div className="space-y-1.5">
          <p>{triage.brief}</p>
          <p className="text-muted-foreground">Confidence: {triage.confidence}.</p>
        </div>
      }
    >
      <span className={`${CHIP} ${TONE[triage.verdict]} ${className}`}>
        {GUARD_TRIAGE_WORD[triage.verdict]}
      </span>
    </HoverPopover>
  );
}
