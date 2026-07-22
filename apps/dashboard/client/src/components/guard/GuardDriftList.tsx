/**
 * The Runs view's MIDDLE column — the selected run's FULL results as one FLAT
 * list. Non-pass scenarios lead, ordered by severity (fail → error → stale →
 * orphaned); each row leads with its compact outcome badge, so no group headers
 * repeat what the rows already say. The passing scenarios sit behind a single
 * collapsible "Passed" divider (auto-collapsed past PASS_GROUP_EXPAND_MAX so a
 * long green list never buries the failures). Rows are previewable:
 * single-click previews, double-click pins.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GuardScenarioResult } from '@truecourse/shared';
import { formatGuardDuration, sectionLeaf } from '@/lib/guard-drifts';
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
        <GuardStatusBadge status={scenario.outcome} compact />
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
  const hasDrifts = drifts.length > 0;
  const [passExpanded, setPassExpanded] = useState(!hasDrifts || passed.length <= PASS_GROUP_EXPAND_MAX);

  const showPassGroup = passed.length > 0 || !hasDrifts;

  return (
    <div data-testid="drift-list" className="flex h-full flex-col overflow-y-auto">
      {drifts.map((d) => (
        <GuardScenarioRow
          key={d.id}
          scenario={d}
          active={d.id === activeId}
          meta={`${d.binds.doc} › ${sectionLeaf(d.binds.section)}`}
          onPreview={() => onPreview(d.id)}
          onPin={() => onPin(d.id)}
        />
      ))}

      {showPassGroup && (
        <div>
          <div className="sticky top-0 z-10 bg-background">
            <button
              type="button"
              onClick={() => setPassExpanded((v) => !v)}
              aria-expanded={passExpanded}
              aria-label={passExpanded ? 'Collapse passed scenarios' : 'Expand passed scenarios'}
              className="flex w-full items-center justify-between border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
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
