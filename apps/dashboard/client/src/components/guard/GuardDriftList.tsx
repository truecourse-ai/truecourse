/**
 * The Runs view's MIDDLE column — the selected run's FULL results. The non-pass
 * scenarios lead, severity-grouped (fail → error → stale → orphaned, most severe
 * first) with a sticky tinted header per group, followed by a collapsible
 * "passed" group. Rows lead with the outcome badge (never added/resolved framing)
 * and are previewable: single-click previews, double-click pins. Mirrors the
 * verify `VerifyPanel` list idiom.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GuardScenarioResult } from '@truecourse/shared';
import { guardStatusMeta } from '@/lib/guard-status';
import { GUARD_DRIFT_ORDER, docBasename, formatGuardDuration, sectionLeaf } from '@/lib/guard-drifts';
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
  onPreview,
  onPin,
}: {
  scenario: GuardScenarioResult;
  active: boolean;
  /** The row's third line: the binding leaf for a drift, the duration for a pass. */
  meta: string;
  onPreview: () => void;
  onPin: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPreview}
      onDoubleClick={onPin}
      title="Click to preview, double-click to pin"
      className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <GuardStatusBadge status={scenario.outcome} />
        <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-muted-foreground">{scenario.id}</span>
      </div>
      <span className="text-[13px] leading-snug text-foreground line-clamp-2">{scenario.title}</span>
      <span className="truncate text-[10px] text-muted-foreground">{meta}</span>
    </button>
  );
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
  /** The run's passing scenarios, original order. */
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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
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
            </div>
            {g.rows.map((d) => (
              <GuardScenarioRow
                key={d.id}
                scenario={d}
                active={d.id === activeId}
                meta={`${docBasename(d.binds.doc)} › ${sectionLeaf(d.binds.section)}`}
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
          {passExpanded &&
            passed.map((p) => (
              <GuardScenarioRow
                key={p.id}
                scenario={p}
                active={p.id === activeId}
                meta={`pass · ${formatGuardDuration(p.durationMs)}`}
                onPreview={() => onPreview(p.id)}
                onPin={() => onPin(p.id)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
