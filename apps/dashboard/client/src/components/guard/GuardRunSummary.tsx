/**
 * The Runs view's LEFT panel — the run picker. Just the recent-run history;
 * the selected run's envelope and tallies render in the main-pane overview.
 * Clicking a history row retargets the whole view to that run. Read-only.
 */

import type { GuardHistoryEntry, GuardOutcome } from '@truecourse/shared';
import { GUARD_OUTCOMES, formatGuardTime, shortRunId } from '@/lib/guard-drifts';

/** The per-outcome mark used in the compact history mini-tally. */
const MARK: Record<GuardOutcome, string> = { pass: '✓', fail: '✗', error: '⚠', stale: '~', orphaned: '○' };

export function GuardRunSummary({
  history,
  selectedRunId,
  onSelectRun,
}: {
  history: GuardHistoryEntry[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const recent = [...history].sort((a, b) => b.ranAt.localeCompare(a.ranAt));

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* The run's envelope/tallies live in the main-pane overview — this panel
          is only the run picker. */}
      {/* Run history */}
      <div className="p-2">
        <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent runs</div>
        {recent.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-muted-foreground">No earlier runs recorded.</p>
        ) : (
          recent.map((h) => {
            const active = h.runId === selectedRunId;
            return (
              <button
                key={h.runId}
                type="button"
                onClick={() => onSelectRun(h.runId)}
                onDoubleClick={() => onSelectRun(h.runId)}
                className={`flex w-full flex-col gap-0.5 rounded px-1.5 py-1.5 text-left transition-colors ${
                  active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-foreground">{shortRunId(h.runId)}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatGuardTime(h.ranAt)}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {GUARD_OUTCOMES.map((o) => `${h.summary[o]}${MARK[o]}`).join(' ')}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
