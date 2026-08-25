/**
 * The Runs view's LEFT panel — THE reading of the selected run: its envelope
 * (ranAt · branch @ commit · recipe fingerprint), how long it took, and the history
 * that switches between runs. Clicking a history row retargets the whole view to
 * that run. Read-only.
 *
 * It carries NO outcome tally. The results list in the middle column is grouped by
 * outcome and counts each group, so a tally card here was the same numbers a second
 * time — and two places that count one run are two places that can disagree.
 */

import type { GuardHistoryEntry, GuardLatest, GuardOutcome } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import {
  GUARD_OUTCOMES,
  formatGuardDuration,
  formatGuardTime,
  guardRunRef,
  shortFingerprint,
  shortRunId,
} from '@/lib/guard-drifts';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

/** The per-outcome mark used in the compact history mini-tally. */
const MARK: Record<GuardOutcome, string> = {
  pass: '✓',
  fail: '✗',
  error: '⚠',
  stale: '~',
  orphaned: '○',
  blocked: '⊘',
};

export function GuardRunSummary({
  run,
  history,
  selectedRunId,
  onSelectRun,
}: {
  /** The selected run — its envelope and its duration. Null before the first load. */
  run?: GuardLatest | null;
  history: GuardHistoryEntry[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const recent = [...history].sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  const env = run?.run;
  const ref = env ? guardRunRef(env) : null;
  const totalMs = (run?.scenarios ?? []).reduce((n, s) => n + s.durationMs, 0);

  return (
    <div role="region" aria-label="Run summary" className="flex h-full flex-col overflow-y-auto">
      {env && run && (
        <div className="space-y-3 border-b border-border p-3">
          {/* Provenance — which run this whole view is showing. */}
          <div>
            <div className={LABEL}>Run</div>
            <div className="mt-0.5 text-[12px] text-foreground">{formatGuardTime(env.ranAt)}</div>
            {ref && <div className="truncate text-[11px] text-muted-foreground">{ref}</div>}
            <HoverPopover portal align="start" content="Recipe inputs fingerprint recorded at run time">
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                recipe fingerprint {shortFingerprint(env.recipeFingerprint)}
              </div>
            </HoverPopover>
          </div>

          <div>
            <div className={LABEL}>Duration</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{formatGuardDuration(totalMs)}</div>
          </div>
        </div>
      )}

      {/* Run history — the picker. */}
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
