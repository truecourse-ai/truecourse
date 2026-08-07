/**
 * The Flows tab's LEFT PANEL — the flow inventory that replaced the flat scenario
 * list (flows are the product vocabulary; a scenario is reached through its flow).
 * ONE flat list, no grouping chrome: every row is a flow with a status, failing
 * flows first (severity-led). Findings are not a block of their own — a flow
 * carrying them reads as Failed and opens them in its detail.
 *
 * A flow row carries what a user judges a flow by and nothing else: its title and
 * goal, ONE status word (the five of coverage:
 * Failed / Blocked / Never run / Succeeded / Not testable — every row,
 * whatever the flow's shape), the surfaces it runs on, and the epic/manual
 * markers. What a blocked flow NEEDS, the generator's reason for it, and the
 * milestone / section counts are all detail copy — a row never carries a sentence
 * or a tally.
 *
 * The list itself — search, the status filter chips, the row interaction, the
 * scroll-to-selection — is the shared {@link EntityList}; this file is the flow's
 * ROW and the flow's narrowing rules, nothing more.
 *
 * A flow the user RULED OUT stays in the list, muted and marked: hiding it would
 * make the ruling unreachable (only the detail can undo it), and the corpus keeps
 * synthesizing the flow whether or not anyone tests it. The row is the state; the
 * detail is where it is undone.
 */

import { useMemo } from 'react';
import { Layers, PenLine } from 'lucide-react';
import type { GuardFlowListItem } from '@truecourse/shared';
import { GUARD_COVERAGE_STATUS_PRECEDENCE } from '@truecourse/shared';
import { EntityList, type FilterOption } from '@/components/ui/entity-list';
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
import {
  GuardDismissedChip,
  GuardFlowStatusChip,
  GuardNotInSpecsChip,
  GuardToolDefectChip,
} from './GuardStatusBadge';
import { GuardSurfaceChip } from './GuardSurfaceChip';

/**
 * Severity-led sort key: the plain status first (the order the filter offers),
 * then the shared worst-first coverage precedence inside a group, then the title.
 */
function severityKey(flow: GuardFlowListItem): [number, number, string] {
  const rank = GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(flow.status);
  return [
    GUARD_FLOW_STATUS_ORDER.indexOf(guardFlowPlainStatus(flow)),
    rank === -1 ? GUARD_COVERAGE_STATUS_PRECEDENCE.length : rank,
    flow.title,
  ];
}

function FlowRow({ flow, dismissed }: { flow: GuardFlowListItem; dismissed: boolean }) {
  const plain = guardFlowPlainStatus(flow);
  return (
    <>
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
          <HoverPopover portal width="narrow" content="Hand-written test — it belongs to no synthesized flow.">
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
    </>
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
  // The SAME counts the overview's chips show — one derivation, so a chip and a
  // filter chip can never quote different numbers for the same narrowing. `all`
  // is not a chip: an empty selection IS every flow.
  const options = useMemo<FilterOption[]>(
    () => guardFlowFilterCounts(flows).filter((c) => c.key !== 'all').map(({ key, label, count }) => ({ key, label, count })),
    [flows],
  );

  // PR view whose corpus fell back to the baseline set (the gate ran the baseline
  // flows against the head without re-persisting them).
  const baselineFallback = !!prRef && !!flowsCommit && flowsCommit !== prRef;

  return (
    <EntityList<GuardFlowListItem>
      label="Flow inventory"
      items={flows}
      itemId={(flow) => flowTabId(flow.flowId)}
      activeId={activeId}
      onOpen={onOpen}
      loading={loading}
      error={error}
      sort={(a, b) => {
        const [ap, as, at] = severityKey(a);
        const [bp, bs, bt] = severityKey(b);
        return ap - bp || as - bs || at.localeCompare(bt);
      }}
      search={{
        placeholder: 'Search flows…',
        ariaLabel: 'Search flows',
        match: (f, q) => `${f.title} ${f.goal} ${f.flowId} ${f.docs.join(' ')}`.toLowerCase().includes(q),
      }}
      filter={{
        label: 'Status',
        ariaLabel: 'Filter by status',
        options,
        selected: filter === 'all' ? [] : [filter],
        onChange: (next) => onFilter((next[0] as GuardFlowFilter) ?? 'all'),
        match: (flow, key) => guardFlowMatchesFilter(flow, key as GuardFlowFilter),
      }}
      noun={{ one: 'flow', many: 'flows' }}
      rowClassName={(flow) => (dismissedFlowIds?.has(flow.flowId) ? 'opacity-60' : undefined)}
      renderRow={(flow) => <FlowRow flow={flow} dismissed={dismissedFlowIds?.has(flow.flowId) === true} />}
      noMatch="No flows match these filters."
      // The MAIN pane carries the single CTA empty state — the panel stays quiet so
      // two identical cards never sit side by side.
      emptyText="No flows yet."
      banner={
        baselineFallback ? (
          <div className="shrink-0 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            Showing the baseline flows — this PR didn&apos;t regenerate them.
          </div>
        ) : null
      }
    />
  );
}
