/**
 * The Spec / Guard-Coverage header action: Scan (first curate) or Rescan (re-curate
 * the docs into the corpus). Mirrors the other section header actions
 * (ContractsHeaderActions / GuardHeaderActions) — same outline variant — and carries
 * an amber staleness dot when include/exclude/relation decisions were recorded since
 * the last scan (`stale` = decisionsPending), so one Rescan applies the queued batch.
 */

import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';

interface SpecScanButtonProps {
  /** A corpus exists → the label reads "Rescan"; otherwise "Scan". */
  hasCorpus: boolean;
  scanning: boolean;
  /** decisionsPending — recorded decisions newer than the corpus. */
  stale: boolean;
  onClick: () => void;
}

export function SpecScanButton({ hasCorpus, scanning, stale, onClick }: SpecScanButtonProps) {
  const showDot = stale && !scanning;
  return (
    <HoverPopover
      align="end"
      width="narrow"
      content={showDot ? 'Decisions recorded since the last scan — rescan to apply them.' : null}
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
            aria-label="pending decisions"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
          />
        )}
      </Button>
    </HoverPopover>
  );
}
