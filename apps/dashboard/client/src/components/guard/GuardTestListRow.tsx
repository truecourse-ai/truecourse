/**
 * THE test row's CONTENT — ONE component for the Tests tab's inventory and the
 * Runs tab's result list, because both lists show the same thing: a test, and how
 * it stands.
 *
 *   CLI test · Failing (birth)
 *   Tasks are created, listed newest-first, completed and filterable
 *
 * The lead line names the surface and the ONE status word (both from the shared
 * vocabulary); the title WRAPS — a claim is a sentence, and a sentence cut at the
 * panel's edge is the thing a reader most needs whole. Wrapping never widens the
 * row: every line is width-bound (`w-full` + `min-w-0` + `break-words`), so the
 * list still scrolls DOWN only.
 *
 * The row WRAPPER — its selected paint, its `role="listitem"`, its
 * preview/pin clicks — belongs to {@link EntityList}, which every list that shows
 * these rows is built from.
 *
 * Nothing else rides here. A duration, a failure excerpt, the flow a test serves
 * — each is a second thing to read on a row whose job is "which test, how is it",
 * and each already has a home in the detail the row opens.
 */

import type { GuardDriverId } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { PenLine } from 'lucide-react';
import { guardTestLabel } from '@/lib/guard-tests';
import type { GuardFlowPlainStatus } from '@/lib/guard-flow-status';
import { GuardFlowStatusChip } from './GuardStatusBadge';

/** What a row needs, whichever list feeds it — an entity row or a run result. */
export interface GuardTestListRowData {
  id: string;
  title: string;
  /** The surface it runs on; absent reads as a plain "Test". */
  surface?: GuardDriverId;
  /** The plain status word and the state behind it. */
  status: { plain: GuardFlowPlainStatus; word: string };
  /** True for a test no generate authored — the inventory's one extra marker. */
  handWritten?: boolean;
}

export function GuardTestListRow({ row }: { row: GuardTestListRowData }) {
  return (
    <>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">{guardTestLabel(row.surface)}</span>
        <span className="text-[11px] text-muted-foreground">·</span>
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
      <span className="w-full min-w-0 break-words text-[13px] font-normal leading-snug text-foreground">
        {row.title}
      </span>
    </>
  );
}
