/**
 * Section-level action button for the Contracts tab — kicks off IL
 * extraction (`POST /contracts/generate`). Mirrors `SpecHeaderActions`
 * and `VerifyHeaderActions`: rendered inside the page Header
 * alongside Analyze, never below the per-tab strip.
 */

import { Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';

interface ContractsHeaderActionsProps {
  isGenerating: boolean;
  onGenerate: () => void;
  /** When true, the canonical spec has moved on past the last Generate —
   *  show an amber dot to flag ungenerated changes. */
  stale?: boolean;
}

export function ContractsHeaderActions({
  isGenerating,
  onGenerate,
  stale = false,
}: ContractsHeaderActionsProps) {
  const showDot = stale && !isGenerating;
  return (
    <HoverPopover
      align="end"
      width="narrow"
      content={
        stale
          ? 'Canonical spec has changed since the last Generate. Click to re-extract IL contracts.'
          : null
      }
    >
      <Button
        size="sm"
        onClick={onGenerate}
        disabled={isGenerating}
        className="relative"
      >
        {isGenerating ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wand2 className="mr-2 h-3.5 w-3.5" />
        )}
        {isGenerating ? 'Generating...' : 'Generate'}
        {showDot && (
          <span
            aria-label="ungenerated changes"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
          />
        )}
      </Button>
    </HoverPopover>
  );
}
