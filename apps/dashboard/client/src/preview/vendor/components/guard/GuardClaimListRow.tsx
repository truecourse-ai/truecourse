/**
 * THE claim row's CONTENT, what one claim looks like in a list, wherever that
 * list is (today: the claims a doc section states, read from the section's own
 * detail).
 *
 *   Creating a task prints its id
 *   Adding a task with `relkit add` prints the new task's id on stdout.
 *
 * A claim is a QUOTATION: its short title, and the sentence the doc states. No
 * status, no dot, no chips, a claim has no state of its own, only the flows and
 * tests that trace to it, and those are read in its detail rather than guessed at
 * from a colour in a list.
 *
 * Two siblings share the shape because a reader is asking the same question of
 * all three: a GAP the last generate recorded that no stored claim answers for,
 * and a statement extraction REFUSED.
 *
 * The row WRAPPER, its paint, its `role="listitem"`, its click, belongs to
 * {@link EntityList}.
 */

import type { GuardClaimRow, GuardSectionClaimGap, GuardUntestableRow } from '@/preview/vendor/shared';

export function GuardClaimListRow({ claim }: { claim: GuardClaimRow }) {
  return (
    <>
      <span className="w-full text-[12px] leading-snug text-foreground">{claim.title}</span>
      <span className="w-full text-[11px] leading-snug text-muted-foreground">{claim.claim}</span>
    </>
  );
}

/** A recorded gap no stored claim answers for, the reason IS the row. */
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
