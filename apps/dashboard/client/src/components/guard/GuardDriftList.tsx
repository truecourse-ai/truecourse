/**
 * The Runs view's MIDDLE column — the selected run's FULL results. The non-pass
 * results lead, severity-grouped (fail → error → stale → orphaned, most severe
 * first) with a sticky tinted header per group, followed by a collapsible
 * "passed" group. Rows are previewable: single-click previews, double-click pins.
 * Mirrors the verify `VerifyPanel` list idiom.
 *
 * A row IS the shared {@link GuardTestListRow} the Tests tab renders — same
 * surface + status word + wrapped title, only fed by this run's result instead of
 * the test's latest state. Nothing per-row rides along: the duration and the
 * failure excerpt are in the instance detail one click away.
 *
 * A list panel scrolls DOWN only, and the list clips its x axis —
 * `overflow-y-auto` alone computes x to `auto`, which is how one long title used
 * to make the whole panel scroll sideways.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GuardScenarioResult } from '@truecourse/shared';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import { guardStatusMeta } from '@/lib/guard-status';
import { guardTestStatusView } from '@/lib/guard-flow-status';
import { guardTestSurface } from '@/lib/guard-tests';
import { GUARD_DRIFT_ORDER } from '@/lib/guard-drifts';
import { GuardTestListRow, type GuardTestListRowData } from './GuardTestListRow';

/**
 * Passes are auto-expanded up to this count; beyond it the group collapses by
 * default so a long green list never buries the failures above it. An all-green
 * run (no drifts) always expands — the passes are then the point of the view.
 */
export const PASS_GROUP_EXPAND_MAX = 10;

/** A run result as the shared row's data — the ONLY thing that differs between
 *  this list and the Tests tab's. */
function resultRow(result: GuardScenarioResult): GuardTestListRowData {
  return {
    id: result.id,
    title: result.title,
    ...(guardTestSurface(result.id) ? { surface: guardTestSurface(result.id) } : {}),
    status: guardTestStatusView({
      outcome: result.outcome,
      ...(result.stage ? { stage: result.stage } : {}),
    }),
  };
}

export function GuardDriftList({
  drifts,
  passed,
  activeId,
  onPreview,
  onPin,
}: {
  /** Already ordered fail → error → stale → orphaned by `orderGuardDrifts`. */
  drifts: GuardScenarioResult[];
  /** The run's passing results, original order. */
  passed: GuardScenarioResult[];
  activeId: string | null;
  onPreview: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const groups = GUARD_DRIFT_ORDER.map((outcome) => ({
    outcome,
    rows: drifts.filter((d) => d.outcome === outcome),
  })).filter((g) => g.rows.length > 0);

  const hasDrifts = drifts.length > 0;
  const [passExpanded, setPassExpanded] = useState(!hasDrifts || passed.length <= PASS_GROUP_EXPAND_MAX);

  const passMeta = guardStatusMeta('pass');
  const showPassGroup = passed.length > 0 || !hasDrifts;

  // A result opened from elsewhere (a `?gscn=` deep link, a jump from a test)
  // scrolls its row into view — the cross-navigation rule every panel follows.
  const rows = useScrollToSelected<HTMLDivElement>(activeId, [drifts, passed, passExpanded]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto overflow-x-hidden">
      {groups.map((g) => {
        const meta = guardStatusMeta(g.outcome);
        return (
          <div key={g.outcome}>
            <div className="sticky top-0 z-10 bg-background">
              <div
                className={`flex items-center justify-between border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${meta.badge}`}
              >
                <span>{meta.label}</span>
                <span>{g.rows.length}</span>
              </div>
              {/* Stale/orphaned name their mechanism, not their meaning — one muted
                  line says why these scenarios have no result (they never ran). */}
              {meta.hint && (
                <div className="border-b border-border/60 bg-muted/30 px-3 py-1 text-[10px] leading-snug text-muted-foreground">
                  {meta.hint}
                </div>
              )}
            </div>
            <div role="list" aria-label={`${meta.label} scenarios`}>
              {g.rows.map((d) => (
                <GuardTestListRow
                  key={d.id}
                  row={resultRow(d)}
                  active={d.id === activeId}
                  rowRef={rows.set(d.id)}
                  onPreview={() => onPreview(d.id)}
                  onPin={() => onPin(d.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {showPassGroup && (
        <div>
          <div className="sticky top-0 z-10 bg-background">
            <button
              type="button"
              onClick={() => setPassExpanded((v) => !v)}
              aria-expanded={passExpanded}
              aria-label={passExpanded ? 'Collapse passed scenarios' : 'Expand passed scenarios'}
              className={`flex w-full items-center justify-between border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${passMeta.badge}`}
            >
              <span className="flex items-center gap-1">
                {passExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {hasDrifts ? 'Passed' : `${passed.length} passed · no drift`}
              </span>
              {hasDrifts && <span>{passed.length}</span>}
            </button>
          </div>
          {passExpanded && (
            <div role="list" aria-label="Passed scenarios">
              {passed.map((p) => (
                <GuardTestListRow
                  key={p.id}
                  row={resultRow(p)}
                  active={p.id === activeId}
                  rowRef={rows.set(p.id)}
                  onPreview={() => onPreview(p.id)}
                  onPin={() => onPin(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
