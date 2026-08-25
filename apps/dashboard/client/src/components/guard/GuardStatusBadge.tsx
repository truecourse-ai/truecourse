/**
 * The guard status pills. Both read the ONE status vocabulary
 * (`lib/guard-flow-status.ts`) and the ONE colour table (`lib/guard-status.ts`),
 * so a status looks and READS the same wherever it appears:
 *
 *  - {@link GuardStatusBadge} — a wire status, for the coverage surfaces;
 *  - {@link GuardFlowStatusChip} — the five-status word a flow, a test, or a
 *    surface row wears, in the list and in the detail alike;
 *  - {@link GuardNotInSpecsChip} / {@link GuardDismissedChip} /
 *    {@link GuardToolDefectChip} — the NON-status markers, muted: one for a flow
 *    the specs no longer derive, one for a flow the user ruled out of testing, one
 *    for a flow whose last finding was OUR defect rather than the repo's drift.
 */

import type { GuardSectionCoverageStatus } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import {
  GUARD_DISMISSED_LABEL,
  GUARD_FLOW_STATUS_WORD,
  GUARD_NOT_IN_SPECS_LABEL,
  GUARD_TOOL_DEFECT_HINT,
  GUARD_TOOL_DEFECT_LABEL,
  guardStatusWord,
  type GuardFlowPlainStatus,
} from '@/lib/guard-flow-status';
import { guardFlowStatusDot, guardStatusMeta } from '@/lib/guard-status';

const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';

/** The status idiom: colored dot + full-contrast word. Capsules are for markers. */
const STATUS = 'inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground';
const DOT = 'h-2 w-2 shrink-0 rounded-full';

/**
 * A SECTION's coverage status — one of the five words, its precise wire status
 * carried by the dot's colour. Which state produced the word is the detail's job
 * (the reason line under this badge, and the per-flow / per-claim rows below it).
 */
export function GuardStatusBadge({
  status,
  className = '',
}: {
  status: GuardSectionCoverageStatus;
  className?: string;
}) {
  const meta = guardStatusMeta(status);
  return (
    <span title={meta.hint} className={`${STATUS} uppercase tracking-wider ${className}`}>
      <span aria-hidden className={`${DOT} ${meta.dot}`} />
      {guardStatusWord(status)}
    </span>
  );
}

/**
 * The one word a flow / surface wears — the five of coverage: "Succeeded",
 * "Failed", "Blocked", "Not testable", "Never run". `word` overrides it for a row
 * that is a TEST rather than coverage, which keeps the run-verdict wording
 * ("Passing", "Failing (birth)").
 */
export function GuardFlowStatusChip({
  status,
  word,
  className = '',
}: {
  status: GuardFlowPlainStatus;
  word?: string;
  className?: string;
}) {
  return (
    <span className={`${STATUS} ${className}`}>
      <span aria-hidden className={`${DOT} ${guardFlowStatusDot(status)}`} />
      {word ?? GUARD_FLOW_STATUS_WORD[status]}
    </span>
  );
}

/**
 * The marker a flow the specs no longer derive wears beside its status chips —
 * the one thing on the row that says "this came from nowhere". Muted on purpose:
 * it is not a status, so it never takes a status colour, and the detail keeps the
 * sentence that explains it.
 */
export function GuardNotInSpecsChip({ className = '' }: { className?: string }) {
  return (
    <span className={`${CHIP} bg-muted text-foreground ${className}`}>{GUARD_NOT_IN_SPECS_LABEL}</span>
  );
}

/**
 * The marker a flow the user ruled out of testing wears — muted for the same
 * reason as its sibling above: a dismissal is a decision about whether the flow
 * should be tested at all, never a verdict on whether it passes, so it takes no
 * status colour and never replaces the status chip beside it.
 */
export function GuardDismissedChip({ className = '' }: { className?: string }) {
  return (
    <span className={`${CHIP} bg-muted text-foreground ${className}`}>{GUARD_DISMISSED_LABEL}</span>
  );
}

/**
 * The marker a flow wears when the last generate's finding was OUR defect — a
 * scenario judged faulty and withheld, never committed. Muted like its siblings,
 * and for the strongest reason of the three: rendering our own defect in a failure
 * colour would report a broken repo where nothing is broken. It never replaces the
 * status chip; the flow's real state is whatever its tests say.
 */
export function GuardToolDefectChip({ className = '' }: { className?: string }) {
  return (
    <HoverPopover portal width="wide" content={GUARD_TOOL_DEFECT_HINT}>
      <span className={`${CHIP} bg-muted text-foreground ${className}`}>
        {GUARD_TOOL_DEFECT_LABEL}
      </span>
    </HoverPopover>
  );
}
