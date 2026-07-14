/**
 * The Runs view's MAIN-PANE OVERVIEW — what shows when no scenario tab is open
 * (and again when the last tab closes). The richer twin of the left run-summary
 * aside: the run envelope (ranAt · branch @ commit · recipe fingerprint), the
 * outcome tallies, and duration stats (total scenario time + the slowest one),
 * plus any load error. The compact aside stays the at-a-glance column; this is
 * the roomier default read of the selected run. Read-only.
 */

import type { GuardLatest, GuardScenarioResult } from '@truecourse/shared';
import { AlertCircle } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import { guardStatusMeta } from '@/lib/guard-status';
import { GUARD_OUTCOMES, formatGuardDuration, formatGuardTime, guardRunRef, shortFingerprint } from '@/lib/guard-drifts';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

function slowestScenario(scenarios: readonly GuardScenarioResult[]): GuardScenarioResult | null {
  return scenarios.reduce<GuardScenarioResult | null>(
    (max, s) => (max == null || s.durationMs > max.durationMs ? s : max),
    null,
  );
}

export function GuardRunOverview({ run, error }: { run: GuardLatest; error?: string | null }) {
  const env = run.run;
  const s = run.summary;
  const ref = guardRunRef(env);
  const totalMs = run.scenarios.reduce((n, sc) => n + sc.durationMs, 0);
  const slowest = slowestScenario(run.scenarios);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-3 px-5 py-4">
        {error && (
          <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Envelope — provenance for the selected run. */}
        <div className="rounded border border-border bg-card p-4">
          <div className={LABEL}>Provenance</div>
          <div className="mt-1 text-sm text-foreground">{formatGuardTime(env.ranAt)}</div>
          {ref && <div className="text-xs text-muted-foreground">{ref}</div>}
          <HoverPopover align="start" content="Recipe inputs fingerprint recorded at run time">
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
              recipe fingerprint {shortFingerprint(env.recipeFingerprint)}
            </div>
          </HoverPopover>
        </div>

        {/* Outcome tallies — the richer main-pane rendering of the aside's group. */}
        <div className="rounded border border-border bg-card p-4">
          <div className={`mb-2 ${LABEL}`}>Outcomes</div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Run outcome tallies">
            {GUARD_OUTCOMES.map((o) => {
              const meta = guardStatusMeta(o);
              return (
                <div
                  key={o}
                  className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2 py-1"
                >
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm font-semibold text-foreground">{s[o]}</span>
                  <span className="text-xs text-muted-foreground">{meta.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Duration stats. */}
        <div className="rounded border border-border bg-card p-4">
          <div className={`mb-1 ${LABEL}`}>Duration</div>
          <HoverPopover align="start" content={`${Math.round(totalMs)} ms across ${s.total} scenarios`}>
            <div className="text-sm text-foreground">
              {s.total} scenario{s.total === 1 ? '' : 's'} · {formatGuardDuration(totalMs)} total
            </div>
          </HoverPopover>
          {slowest && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Slowest: {slowest.title} · {formatGuardDuration(slowest.durationMs)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
