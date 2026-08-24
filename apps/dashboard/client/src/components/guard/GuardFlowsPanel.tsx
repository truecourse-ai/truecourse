/**
 * The Flows tab's LEFT PANEL — the flow inventory that replaced the flat scenario
 * list (flows are the product vocabulary; a scenario is reached through its flow).
 * ONE flat list, no grouping chrome: every row is a flow with a status, failing
 * flows first (severity-led). Findings are not a block of their own — a flow
 * carrying them reads as Failing and opens them in its detail. Every row is
 * previewable — single-click previews it in a main-pane tab, double-click pins it.
 *
 * A flow row carries what a user judges a flow by and nothing else: its title and
 * goal, ONE status word (Passing / Failing / Blocked / Not generated — every row,
 * whatever the flow's shape), the surfaces it runs on, and the epic/manual
 * markers. What a blocked flow NEEDS, the generator's reason for it, and the
 * milestone / section counts are all detail copy — a row never carries a sentence
 * or a tally. Search and a plain status filter sit on top; the recipe and
 * last-generate story lives in the main pane's overview, not here.
 *
 * A flow the user RULED OUT stays in the list, muted and marked: hiding it would
 * make the ruling unreachable (only the detail can undo it), and the corpus keeps
 * synthesizing the flow whether or not anyone tests it. The row is the state; the
 * detail is where it is undone.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Layers, Loader2, PenLine } from 'lucide-react';
import type { GuardFlowListItem } from '@truecourse/shared';
import { GUARD_COVERAGE_STATUS_PRECEDENCE } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import {
  GUARD_FLOW_STATUS_ORDER,
  GUARD_UNDERIVED_SENTENCE,
  guardFlowFilterCounts,
  guardFlowMatchesFilter,
  guardFlowPlainStatus,
  type GuardFlowFilter,
} from '@/lib/guard-flow-status';
import { flowTabId } from '@/hooks/useGuardFlowTabs';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import {
  GuardDismissedChip,
  GuardFlowStatusChip,
  GuardNotInSpecsChip,
  GuardToolDefectChip,
} from './GuardStatusBadge';
import { GuardSurfaceChip } from './GuardSurfaceChip';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

const ROW =
  'flex w-full flex-col items-start gap-1 border-b border-border/60 px-3 py-2 text-left transition-colors';

/**
 * Severity-led sort key: the plain status first (failing, blocked, not generated,
 * passing — the order the filter offers), then the shared worst-first coverage
 * precedence inside a group, then the title.
 */
function severityKey(flow: GuardFlowListItem): [number, number, string] {
  const rank = GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(flow.status);
  return [
    GUARD_FLOW_STATUS_ORDER.indexOf(guardFlowPlainStatus(flow)),
    rank === -1 ? GUARD_COVERAGE_STATUS_PRECEDENCE.length : rank,
    flow.title,
  ];
}

function FlowRow({
  flow,
  active,
  dismissed,
  onOpen,
  rowRef,
}: {
  flow: GuardFlowListItem;
  active: boolean;
  /** The user ruled this flow out — muted, marked, still previewable. */
  dismissed: boolean;
  onOpen: (id: string, pinned: boolean) => void;
  rowRef: (el: HTMLButtonElement | null) => void;
}) {
  const id = flowTabId(flow.flowId);
  const plain = guardFlowPlainStatus(flow);
  return (
    <button
      ref={rowRef}
      type="button"
      role="listitem"
      onClick={() => onOpen(id, false)}
      onDoubleClick={() => onOpen(id, true)}
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'} ${dismissed ? 'opacity-60' : ''}`}
    >
      <span className="w-full truncate text-[13px] font-normal leading-snug text-foreground">{flow.title}</span>
      {/* The goal slot. A flow the specs no longer derive has none — and no title
          either, so the row would otherwise be a bare id: the same sentence its
          detail shows takes the slot. */}
      {flow.goal ? (
        <span className="w-full truncate text-[11px] leading-snug text-muted-foreground">{flow.goal}</span>
      ) : (
        flow.orphaned && (
          <span className="w-full truncate text-[11px] leading-snug text-muted-foreground">
            {GUARD_UNDERIVED_SENTENCE}
          </span>
        )
      )}
      <div className="flex w-full flex-wrap items-center gap-1">
        {/* The row's own status — never borrowed from the surface chips, which a
            flow whose scenario died at birth doesn't have. */}
        <GuardFlowStatusChip status={plain} />
        {/* Not a status: the marker for a flow the specs no longer derive, so a
            scan of the list spots it without reading the sentence. */}
        {flow.orphaned && <GuardNotInSpecsChip />}
        {/* Also not a status — the user's own ruling. Its undo lives in the detail. */}
        {dismissed && <GuardDismissedChip />}
        {/* Nor is this one: the last generate produced a finding that was OUR
            defect, so nothing was committed and nothing here is red. */}
        {flow.toolDefects > 0 && <GuardToolDefectChip />}
        {flow.epic && (
          <HoverPopover portal width="narrow" content="Epic flow — it chains other flows end to end.">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Layers className="h-3 w-3" />
              epic
            </span>
          </HoverPopover>
        )}
        {flow.manual && (
          <HoverPopover portal width="narrow" content="Hand-written scenario — it belongs to no synthesized flow.">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <PenLine className="h-3 w-3" />
              manual
            </span>
          </HoverPopover>
        )}
        {flow.surfaces.map((s, i) => (
          <GuardSurfaceChip key={`${s.surface ?? 'none'}-${i}`} data={s} compact />
        ))}
      </div>
    </button>
  );
}

export function GuardFlowsPanel({
  flows,
  loading,
  error,
  activeId,
  filter,
  onFilter,
  onOpen,
  prRef,
  flowsCommit,
  dismissedFlowIds,
}: {
  flows: GuardFlowListItem[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** The flows the user ruled out (`scenarios/decisions.json`) — the row marker. */
  dismissedFlowIds?: ReadonlySet<string>;
  /** The active filter, owned above so the overview's chips set the same one. */
  filter: GuardFlowFilter;
  onFilter: (filter: GuardFlowFilter) => void;
  /** Single-click preview (transient tab), double-click pin — the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
  /** The PR head ref scoping this view (EE PR view); undefined at repo level. */
  prRef?: string | null;
  /** The commit the corpus was read at (hosted) — the baseline-fallback label. */
  flowsCommit?: string | null;
}) {
  const [search, setSearch] = useState('');

  // The SAME counts the overview's chips show — one derivation, so the dropdown
  // and a chip can never quote different numbers for the same filter.
  const counts = useMemo(() => guardFlowFilterCounts(flows), [flows]);

  const visibleFlows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flows
      .filter((f) => {
        if (!guardFlowMatchesFilter(f, filter)) return false;
        if (!q) return true;
        return `${f.title} ${f.goal} ${f.flowId} ${f.docs.join(' ')}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const [ap, as, at] = severityKey(a);
        const [bp, bs, bt] = severityKey(b);
        return ap - bp || as - bs || at.localeCompare(bt);
      });
  }, [flows, filter, search]);

  // A selection that arrived with the view (a `?gflow=` deep link from Coverage)
  // is off-screen in a long list — bring the row to the user. Same mechanism in
  // every guard panel.
  const rows = useScrollToSelected<HTMLButtonElement>(activeId, [visibleFlows]);

  if (loading && flows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && flows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (flows.length === 0) {
    // The MAIN pane carries the single CTA empty state — the panel stays quiet so
    // two identical cards never sit side by side.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-muted-foreground">No flows yet.</p>
      </div>
    );
  }

  // PR view whose corpus fell back to the baseline set (the gate ran the baseline
  // flows against the head without re-persisting them).
  const baselineFallback = !!prRef && !!flowsCommit && flowsCommit !== prRef;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {baselineFallback && (
        <div className="shrink-0 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the baseline flows — this PR didn&apos;t regenerate them.
        </div>
      )}

      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search flows…"
          aria-label="Search flows"
          className={`${SELECT} w-full`}
        />
        <select
          value={filter}
          onChange={(e) => onFilter(e.target.value as GuardFlowFilter)}
          aria-label="Filter by status"
          className={`${SELECT} w-full`}
        >
          <option value="all">All flows</option>
          {counts
            .filter((c) => c.key !== 'all')
            .map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
        </select>
        <div className="text-[11px] text-muted-foreground">
          {visibleFlows.length} of {flows.length} flow{flows.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Down only — every row line truncates, so sideways scroll is never right. */}
      {visibleFlows.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No flows match these filters.</div>
      ) : (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          role="list"
          aria-label="Flow inventory"
        >
          {visibleFlows.map((flow) => {
            const id = flowTabId(flow.flowId);
            return (
              <FlowRow
                key={flow.flowId}
                flow={flow}
                active={activeId === id}
                dismissed={dismissedFlowIds?.has(flow.flowId) === true}
                onOpen={onOpen}
                rowRef={rows.set(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
