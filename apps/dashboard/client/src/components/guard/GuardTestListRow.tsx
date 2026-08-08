/**
 * A RESULT row — what a run's result list shows: a test, and how it stands.
 *
 *   Tasks are created, listed newest-first, completed and filterable
 *   Failing (birth)  hand-written
 *
 * ONE ROW ANATOMY, shared by every guard list (the flow inventory, a run's
 * results): the TITLE first — it wraps, because a claim is a sentence and a
 * sentence cut at the panel's edge is the thing a reader most needs whole — then
 * the chip line, whose FIRST chip is always the one status word. Anything else on
 * the line is a marker, never a status, and never takes a status colour.
 *
 * Wrapping never widens the row: every line is width-bound (`w-full` + `min-w-0` +
 * `break-words`), so the list still scrolls DOWN only.
 *
 * There is no SURFACE label. Guard runs one surface per flow today, so "CLI test"
 * said the same word on every row; when a second surface exists it comes back as a
 * plain label on this line, after the status — not as a chip.
 *
 * The row WRAPPER — its selected paint, its `role="listitem"`, its preview/pin
 * clicks — belongs to {@link EntityList}, which every list that shows these rows
 * is built from.
 *
 * Nothing else rides here. A duration, a failure excerpt, the flow a test serves —
 * each is a second thing to read on a row whose job is "which test, how is it",
 * and each already has a home in the detail the row opens.
 */

import { HoverPopover } from '@/components/ui/hover-popover';
import { PenLine } from 'lucide-react';
import type { GuardFlowPlainStatus } from '@/lib/guard-flow-status';
import { GuardFlowStatusChip } from './GuardStatusBadge';

/** What a row needs — a run result today, any test-shaped row tomorrow. */
export interface GuardTestListRowData {
  id: string;
  title: string;
  /** The plain status word and the state behind it. */
  status: { plain: GuardFlowPlainStatus; word: string };
  /** True for a test no generate authored — the one extra marker a result wears. */
  handWritten?: boolean;
}

export function GuardTestListRow({ row }: { row: GuardTestListRowData }) {
  return (
    <>
      <span className="w-full min-w-0 break-words text-[13px] font-normal leading-snug text-foreground">
        {row.title}
      </span>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-1">
        <GuardFlowStatusChip status={row.status.plain} word={row.status.word} />
        {row.handWritten && (
          <HoverPopover portal width="narrow" content="Hand-written — no generate authored it.">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <PenLine className="h-3 w-3" />
              hand-written
            </span>
          </HoverPopover>
        )}
      </div>
    </>
  );
}
