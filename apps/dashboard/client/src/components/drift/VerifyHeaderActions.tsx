/**
 * Section-level action button for the Verify tab. Rendered inside the
 * page Header alongside Analyze (and the Spec actions when active),
 * so global controls don't disappear when switching between drift
 * tabs and cause the left sidebar to shift vertically.
 */

import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';

interface VerifyHeaderActionsProps {
  isRunning: boolean;
  onRun: () => void;
  /** When true, contracts have been re-generated since the last
   *  verify run — show an amber dot to flag stale drift state. */
  stale?: boolean;
}

export function VerifyHeaderActions({
  isRunning,
  onRun,
  stale = false,
}: VerifyHeaderActionsProps) {
  const showDot = stale && !isRunning;
  return (
    <HoverPopover
      align="end"
      width="narrow"
      content={
        stale
          ? 'Contracts have changed since the last Verify. Click to re-check code against the new contracts.'
          : null
      }
    >
      <Button
        size="sm"
        onClick={onRun}
        disabled={isRunning}
        className="relative"
      >
        {isRunning ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="mr-2 h-3.5 w-3.5" />
        )}
        {isRunning ? 'Verifying...' : 'Verify'}
        {showDot && (
          <span
            aria-label="unverified changes"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
          />
        )}
      </Button>
    </HoverPopover>
  );
}
