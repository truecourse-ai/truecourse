/**
 * THE test row — ONE component for the Tests tab's inventory and the Runs tab's
 * result list, because both lists show the same thing: a test, and how it stands.
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
  /** The surface it runs on; absent reads as a plain "Scenario". */
  surface?: GuardDriverId;
  /** The plain status word and the state behind it. */
  status: { plain: GuardFlowPlainStatus; word: string };
  /** True for a scenario no generate authored — the inventory's one extra marker. */
  handWritten?: boolean;
}

const ROW =
  'flex w-full min-w-0 flex-col items-start gap-1 border-b border-border/60 px-3 py-2 text-left transition-colors';

export function GuardTestListRow({
  row,
  active,
  onPreview,
  onPin,
  rowRef,
}: {
  row: GuardTestListRowData;
  active: boolean;
  /** Single-click — preview in the pane. */
  onPreview: () => void;
  /** Double-click — pin the preview. */
  onPin: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={rowRef}
      role="listitem"
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
    >
      <button
        type="button"
        onClick={onPreview}
        onDoubleClick={onPin}
        className="flex w-full min-w-0 flex-col items-start gap-1 text-left"
      >
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
      </button>
    </div>
  );
}
