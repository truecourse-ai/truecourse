/**
 * Section-level action button for the Guard tabs — one action per tab: Generate on
 * the Flows tab (synthesizes flows + authors scenarios; opens the estimate modal
 * first), Map on the Journeys tab (derives the journey catalog from the working
 * tree — deterministic, LLM-free, FREE, so it names its own price and never opens
 * an estimate), and Run on the Runs tab (runs the committed scenarios; no estimate). Rendered inside the page Header
 * alongside the other section actions, mirroring ContractsHeaderActions /
 * VerifyHeaderActions. Both render the same `outline` variant as the Spec
 * tab's Scan/Rescan button, so every guard-context header action shares one
 * look. Each button carries its own amber staleness dot and is disabled — with
 * a HoverPopover reason — while any guard job is in flight.
 */

import { Loader2, Play, Route, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';

interface GuardHeaderActionsProps {
  kind: 'generate' | 'run' | 'map';
  onClick: () => void;
  /** This action is in flight. */
  busy: boolean;
  /** The OTHER guard action (or a conflicting job) is in flight — disabled + a reason. */
  otherBusy: boolean;
  /** Amber-dot staleness signal for this action. */
  stale?: boolean;
}

export function GuardHeaderActions({ kind, onClick, busy, otherBusy, stale = false }: GuardHeaderActionsProps) {
  const disabled = busy || otherBusy;
  const showDot = stale && !disabled;

  const label =
    kind === 'generate'
      ? busy
        ? 'Generating…'
        : 'Generate'
      : kind === 'map'
        ? busy
          ? 'Mapping…'
          : 'Map · free, no LLM'
        : busy
          ? 'Running…'
          : 'Run';

  const staleReason =
    kind === 'generate'
      ? 'The spec corpus changed since the last generate — regenerate to write scenarios for the edits.'
      : kind === 'map'
        ? 'The working tree changed since the last mapping — re-map to re-derive the journeys.'
        : 'The scenarios changed since the last run — re-run to see where they stand.';

  const reason = otherBusy
    ? 'A guard job is already running — wait for it to finish.'
    : stale
      ? staleReason
      : null;

  const Icon = busy ? Loader2 : kind === 'generate' ? Wand2 : kind === 'map' ? Route : Play;

  return (
    <HoverPopover portal align="end" width="narrow" content={reason}>
      <Button size="sm" variant="outline" onClick={onClick} disabled={disabled} className="relative">
        <Icon className={`mr-2 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        {label}
        {showDot && (
          <span
            aria-label={kind === 'generate' ? 'changes not yet generated' : kind === 'map' ? 'unmapped changes' : 'changes not yet run'}
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
          />
        )}
      </Button>
    </HoverPopover>
  );
}
