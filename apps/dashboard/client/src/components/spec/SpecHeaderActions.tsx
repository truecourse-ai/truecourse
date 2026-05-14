/**
 * Section-level action buttons for the Spec tab, rendered inside the
 * page Header alongside Analyze. Pulls state and handlers from
 * SpecContext — must be mounted under `<SpecProvider>`.
 */

import { Check, Loader2, Play, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useSpec } from './SpecContext';

interface SpecHeaderActionsProps {
  /** When true, decisions have moved on past the last materialize —
   *  show an amber dot on Apply to flag unapplied changes. */
  stale?: boolean;
}

export function SpecHeaderActions({ stale = false }: SpecHeaderActionsProps) {
  const { scan, loading, applying, refresh, acceptAllDefaults, apply } = useSpec();
  const hasOpen = (scan?.openConflicts.length ?? 0) > 0;
  const disabled = !scan;
  const showDot = stale && !hasOpen && !applying && !disabled;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={refresh}
        disabled={loading}
        title="Discover docs, extract claims, surface conflicts"
      >
        {loading ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="mr-2 h-3.5 w-3.5" />
        )}
        {loading ? 'Scanning...' : 'Scan'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={acceptAllDefaults}
        disabled={disabled || !hasOpen || loading}
        title="Accept the engine's default pick on every open conflict (chains first, then content)"
      >
        <Wand2 className="mr-2 h-3.5 w-3.5" />
        Accept all defaults
      </Button>
      <HoverPopover
        align="end"
        width="narrow"
        content={
          hasOpen
            ? 'Resolve all open conflicts first.'
            : stale
              ? 'Decisions have changed since the last Apply. Click to re-materialize the canonical spec.'
              : null
        }
      >
        <Button
          size="sm"
          onClick={apply}
          disabled={disabled || applying || loading || hasOpen}
          className="relative"
        >
          {applying ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Apply
          {showDot && (
            <span
              aria-label="unapplied changes"
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
            />
          )}
        </Button>
      </HoverPopover>
    </>
  );
}
