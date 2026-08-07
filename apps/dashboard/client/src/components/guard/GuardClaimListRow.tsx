/**
 * THE claim row's CONTENT — what one claim looks like in a list, wherever that
 * list is (today: the claims a doc section states, read from the section's own
 * detail).
 *
 *   ● Creating a task prints its id
 *     needs cli, seeded tasks
 *
 * A coverage dot with its meaning on hover, the claim's title, and the muted hint
 * of what testing it would take — plus the gap's reason when nothing carries it,
 * because that reason is the whole point of a hole.
 *
 * Two siblings share the shape because a reader is asking the same question of
 * all three: a GAP the last generate recorded that no stored claim answers for,
 * and a statement extraction REFUSED (not a claim, so never a coverage dot).
 *
 * The row WRAPPER — its paint, its `role="listitem"`, its click — belongs to
 * {@link EntityList}.
 */

import type { GuardClaimRow, GuardSectionClaimGap, GuardUntestableRow } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { GUARD_CLAIM_COVERAGE, guardClaimNeedsHint } from '@/lib/guard-claims';

export function GuardClaimListRow({ claim }: { claim: GuardClaimRow }) {
  const meta = GUARD_CLAIM_COVERAGE[claim.coverage];
  return (
    <>
      <div className="flex w-full items-start gap-2">
        <HoverPopover portal width="narrow" content={`${meta.label} — ${meta.hint}`}>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        </HoverPopover>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">{claim.title}</span>
      </div>
      <span className="w-full truncate pl-4 text-[11px] text-muted-foreground">{guardClaimNeedsHint(claim)}</span>
      {claim.gapReason && (
        <span className="w-full pl-4 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          {claim.gapReason}
        </span>
      )}
    </>
  );
}

/** A recorded gap no stored claim answers for — the reason IS the row. */
export function GuardClaimGapListRow({ gap }: { gap: GuardSectionClaimGap }) {
  return (
    <>
      <span className="w-full text-[12px] leading-snug text-foreground">
        {gap.title ?? 'A claim in this section'}
      </span>
      <span className="w-full text-[11px] leading-snug text-muted-foreground">{gap.reason}</span>
    </>
  );
}

/** A statement extraction refused: what it said, and why it is not a claim. */
export function GuardUntestableListRow({ row }: { row: GuardUntestableRow }) {
  return (
    <>
      <span className="w-full truncate text-[12px] italic leading-snug text-muted-foreground">{row.text}</span>
      <span className="w-full truncate text-[11px] text-muted-foreground/80">{row.reason}</span>
    </>
  );
}
