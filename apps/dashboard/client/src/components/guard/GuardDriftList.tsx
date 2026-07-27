/**
 * The Runs view's MIDDLE column — the selected run's FULL results. The non-pass
 * scenarios lead, severity-grouped (fail → error → stale → orphaned, most severe
 * first) with a sticky tinted header per group, followed by a collapsible
 * "passed" group. Rows lead with the outcome badge (never added/resolved framing)
 * and are previewable: single-click previews, double-click pins. Mirrors the
 * verify `VerifyPanel` list idiom.
 *
 * A list panel scrolls DOWN only. Every row line is width-bound and truncates, and
 * the list clips its x axis — `overflow-y-auto` alone computes x to `auto`, which
 * is how one long id used to make the whole panel scroll sideways.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GuardRunFlow, GuardScenarioResult } from '@truecourse/shared';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import { guardStatusMeta } from '@/lib/guard-status';
import { GUARD_DRIFT_ORDER, formatGuardDuration, sectionLeaf } from '@/lib/guard-drifts';
import { GuardStatusBadge } from './GuardStatusBadge';

/**
 * Passes are auto-expanded up to this count; beyond it the group collapses by
 * default so a long green list never buries the failures above it. An all-green
 * run (no drifts) always expands — the passes are then the point of the view.
 */
export const PASS_GROUP_EXPAND_MAX = 10;

function GuardScenarioRow({
  scenario,
  active,
  meta,
  rowRef,
  onPreview,
  onPin,
}: {
  scenario: GuardScenarioResult;
  active: boolean;
  /** The row's third line: the binding leaf for a drift, the duration for a pass. */
  meta: string;
  rowRef: (el: HTMLButtonElement | null) => void;
  onPreview: () => void;
  onPin: () => void;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onPreview}
      onDoubleClick={onPin}
      title="Click to preview, double-click to pin"
      className={`flex w-full min-w-0 flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
      }`}
    >
      {/* Every line is width-BOUND (`w-full` / `min-w-0` + truncate): a long id or
          binding is ellipsised inside the column, never allowed to widen the row
          and scroll the whole list sideways. */}
      <div className="flex w-full min-w-0 items-center gap-2">
        <GuardStatusBadge status={scenario.outcome} />
        <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground">{scenario.id}</span>
      </div>
      <span className="w-full break-words text-[13px] leading-snug text-foreground line-clamp-2">
        {scenario.title}
      </span>
      <span className="w-full truncate text-[10px] text-muted-foreground">{meta}</span>
    </button>
  );
}

export function GuardDriftList({
  drifts,
  passed,
  runFlows = [],
  activeId,
  onPreview,
  onPin,
}: {
  /** Already ordered fail → error → stale → orphaned by `orderGuardDrifts`. */
  drifts: GuardScenarioResult[];
  /** The run's passing scenarios, original order. */
  passed: GuardScenarioResult[];
  /** The run's flow join — lets a failing row name the milestone that broke. */
  runFlows?: GuardRunFlow[];
  activeId: string | null;
  onPreview: (id: string) => void;
  onPin: (id: string) => void;
}) {
  // "failed at milestone 3 · complete" — the flow-instance line a failing row
  // leads with; a result with no flow (or no milestone) keeps its binding leaf.
  const flowById = new Map(runFlows.map((f) => [f.flowId, f]));
  const driftMeta = (d: GuardScenarioResult): string => {
    const flow = d.flowId ? flowById.get(d.flowId) : undefined;
    const milestone = flow?.milestones.find((m) => m.order === d.failedMilestone);
    if (milestone) return `failed at milestone ${milestone.order} · ${milestone.claimTitle}`;
    return `${d.binds.doc} › ${sectionLeaf(d.binds.section)}`;
  };

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
  const rows = useScrollToSelected<HTMLButtonElement>(activeId, [drifts, passed, passExpanded]);

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
            {g.rows.map((d) => (
              <GuardScenarioRow
                key={d.id}
                scenario={d}
                active={d.id === activeId}
                meta={driftMeta(d)}
                rowRef={rows.set(d.id)}
                onPreview={() => onPreview(d.id)}
                onPin={() => onPin(d.id)}
              />
            ))}
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
              aria-label={passExpanded ? 'Collapse passed tests' : 'Expand passed tests'}
              className={`flex w-full items-center justify-between border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${passMeta.badge}`}
            >
              <span className="flex items-center gap-1">
                {passExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {hasDrifts ? 'Passed' : `${passed.length} passed · no drift`}
              </span>
              {hasDrifts && <span>{passed.length}</span>}
            </button>
          </div>
          {passExpanded &&
            passed.map((p) => (
              <GuardScenarioRow
                key={p.id}
                scenario={p}
                active={p.id === activeId}
                meta={`pass · ${formatGuardDuration(p.durationMs)}`}
                rowRef={rows.set(p.id)}
                onPreview={() => onPreview(p.id)}
                onPin={() => onPin(p.id)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
