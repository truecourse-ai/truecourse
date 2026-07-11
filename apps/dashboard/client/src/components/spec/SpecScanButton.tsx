/**
 * The Spec / Guard-Coverage header action: Scan (first curate) or Rescan (re-curate
 * the docs into the corpus). Mirrors the other section header actions
 * (ContractsHeaderActions / GuardHeaderActions) — same outline variant — and carries
 * an amber staleness dot when there is queued work: include/exclude/relation/conflict
 * decisions recorded since the last scan (`decisionsPending`) OR a kept doc edited
 * since it (`docsChanged`), so one Rescan applies the batch.
 */

import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';

interface SpecScanButtonProps {
  /** A corpus exists → the label reads "Rescan"; otherwise "Scan". */
  hasCorpus: boolean;
  scanning: boolean;
  /** Recorded decisions are newer than the corpus. */
  decisionsPending: boolean;
  /** A kept doc changed on disk since the last scan (edited here or outside). */
  docsChanged: boolean;
  onClick: () => void;
}

/** Dot copy covering either or both staleness causes. */
function staleReason(decisionsPending: boolean, docsChanged: boolean): string {
  if (decisionsPending && docsChanged)
    return 'Docs edited and decisions recorded since the last scan — rescan to apply them.';
  if (docsChanged) return 'Docs changed since the last scan — rescan to pick them up.';
  return 'Decisions recorded since the last scan — rescan to apply them.';
}

export function SpecScanButton({ hasCorpus, scanning, decisionsPending, docsChanged, onClick }: SpecScanButtonProps) {
  const showDot = (decisionsPending || docsChanged) && !scanning;
  return (
    <HoverPopover
      align="end"
      width="narrow"
      content={showDot ? staleReason(decisionsPending, docsChanged) : null}
    >
      <Button size="sm" variant="outline" onClick={onClick} disabled={scanning} className="relative">
        {scanning ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="mr-1.5 h-3.5 w-3.5" />
        )}
        {hasCorpus ? 'Rescan' : 'Scan'}
        {showDot && (
          <span
            aria-label="rescan pending"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
          />
        )}
      </Button>
    </HoverPopover>
  );
}
