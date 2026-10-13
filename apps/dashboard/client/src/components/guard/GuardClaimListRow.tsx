/**
 * THE claim row's CONTENT, what one claim looks like in a list: its status
 * word, the sentence the document states, and the document it comes from.
 *
 *   ● Failed   “Save expense” creates the record through POST, closes the dialog…
 *              docs/app.md · Add an expense from the list
 *
 * The row WRAPPER, its paint, its `role="listitem"`, its click, belongs to
 * {@link EntityList}. An untestable statement shares the shape, quieter: it has
 * no status to wear beyond the reason the scan gave.
 */

import type { GuardClaimRow, GuardUntestableRow } from '@truecourse/shared';
import { guardPlainStatus } from '@/lib/guard-flow-status';
import { GuardFlowStatusChip } from '@/components/guard/GuardStatusBadge';

export function GuardClaimListRow({ claim }: { claim: GuardClaimRow }) {
  const flows = claim.flows.map((f) => f.title).join(', ');
  return (
    <>
      <div className="flex w-full items-start gap-2">
        <GuardFlowStatusChip status={guardPlainStatus(claim.status)} className="mt-0.5 w-24 shrink-0" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">{claim.statement}</span>
      </div>
      <span className="w-full truncate pl-[6.5rem] text-[11px] leading-snug text-muted-foreground">
        {claim.doc}
        {flows ? ` · ${flows}` : claim.reason ? ` · ${claim.reason}` : ''}
      </span>
    </>
  );
}

/** A statement the scan judged untestable: what it said, and why it is not a claim. */
export function GuardUntestableListRow({ row }: { row: GuardUntestableRow }) {
  return (
    <>
      <span className="w-full truncate text-[12px] italic leading-snug text-muted-foreground">{row.statement}</span>
      <span className="w-full truncate text-[11px] text-muted-foreground/80">
        {row.doc} · {row.reason}
      </span>
    </>
  );
}
