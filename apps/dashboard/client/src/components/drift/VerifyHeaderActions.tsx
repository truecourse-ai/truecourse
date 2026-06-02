/**
 * Section-level actions for the Verify tab, rendered in the page Header
 * alongside Analyze / Spec actions. Mirrors analyze's header: the past-runs
 * dropdown + a Normal / Git Diff toggle (git repos only) + the Verify run
 * button, all using the shared header components. (The branch label is
 * rendered once by the Header itself, so it isn't duplicated here.)
 */

import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';
import { DiffModeToggle } from '@/components/layout/DiffModeToggle';
import { RunHistoryDropdown, type RunHistoryItem } from '@/components/layout/RunHistoryDropdown';

interface VerifyHeaderActionsProps {
  isRunning: boolean;
  onRun: () => void;
  /** When true, contracts have been re-generated since the last verify run. */
  stale?: boolean;
  /** Diff vs the committed baseline (uncommitted changes). */
  diffMode: boolean;
  onToggleDiff: (diff: boolean) => void;
  /** Verify requires a git repo (like Analyze); hide the run button + diff toggle when absent. */
  isGitRepo: boolean;
  /** Past verify runs (newest-first, items[0] = latest) + selection. */
  runItems: RunHistoryItem[];
  selectedRunId: string | null;
  onSelectRun: (id: string | null) => void;
  /** When viewing a past run, hide the toggle + run button (read-only). */
  viewingHistory: boolean;
}

export function VerifyHeaderActions({
  isRunning,
  onRun,
  stale = false,
  diffMode,
  onToggleDiff,
  isGitRepo,
  runItems,
  selectedRunId,
  onSelectRun,
  viewingHistory,
}: VerifyHeaderActionsProps) {
  const showDot = stale && !isRunning;
  return (
    <div className="flex items-center gap-2">
      <RunHistoryDropdown items={runItems} selectedId={selectedRunId} onSelect={onSelectRun} />

      {isGitRepo && !viewingHistory && (
        <DiffModeToggle
          diffMode={diffMode}
          onToggle={onToggleDiff}
          subject={{ verb: 'verifies', plural: 'drifts' }}
        />
      )}

      {isGitRepo && !viewingHistory && (
        <HoverPopover
          align="end"
          width="narrow"
          content={
            stale
              ? 'Contracts have changed since the last Verify. Click to re-check code against the new contracts.'
              : null
          }
        >
          <Button size="sm" onClick={onRun} disabled={isRunning} className="relative">
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
      )}
    </div>
  );
}
