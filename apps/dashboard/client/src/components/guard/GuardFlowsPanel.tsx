/**
 * THE guard inventory — the ONE list. A flow and the test that realizes it are one
 * entity, so there is one list of them and one detail behind it (no second Tests
 * tab quoting a different count for the same rows).
 *
 * ONE flat list, no grouping chrome, failing flows first (severity-led). Findings
 * are not a block of their own — a flow carrying them reads as Failed and opens
 * them in its detail.
 *
 * ONE ROW ANATOMY, shared with every other guard list: the TITLE, the GOAL, then a
 * chip line whose FIRST chip is the one status word (the five of coverage:
 * Failed / Blocked / Never run / Succeeded / Not testable — every row, whatever the
 * flow's shape). Everything after it is a MARKER, never a status: epic, manual,
 * ruled-out, not-in-specs, our-defect. What a blocked flow NEEDS, the generator's
 * reason for it, and the milestone / section counts are all detail copy — a row
 * never carries a sentence or a tally.
 *
 * NO SURFACE CHIPS. Guard runs one surface per flow today, so a chip per surface
 * repeated the same word down the whole list. When a second surface exists it
 * returns as a plain label on the chip line — a name, not a coloured pill.
 *
 * A hand-written test belongs to no synthesized flow: it is a row here like any
 * other, wearing the `manual` marker. The list is total — everything guard runs is
 * in it.
 *
 * The list itself — search, the status filter chips, the row interaction, the
 * scroll-to-selection — is the shared {@link EntityList}; this file is the flow's
 * ROW, the flow's narrowing rules, and the one surface-level affordance that is
 * not a row: the RECIPE, the preparation every test in this list runs against.
 *
 * A flow the user RULED OUT stays in the list, muted and marked: hiding it would
 * make the ruling unreachable (only the detail can undo it), and the corpus keeps
 * synthesizing the flow whether or not anyone tests it. The row is the state; the
 * detail is where it is undone.
 */

import { useMemo } from 'react';
import { Hammer, Layers, PenLine } from 'lucide-react';
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

export const GUARD_RECIPE_HINT =
  'How guard prepares this repo before a test runs — the build, the entrypoint, the servers and datastores it starts. Discovered once at setup, reused by every run.';

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
        {/* The row's own status, FIRST — never borrowed from a surface, which a
            flow whose test died at birth doesn't have. */}
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
  hasRecipe = false,
  recipeOpen = false,
  onToggleRecipe,
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
  /** The active filter, owned above so it survives a main-pane navigation. */
  filter: GuardFlowFilter;
  onFilter: (filter: GuardFlowFilter) => void;
  /** Single-click preview (transient tab), double-click pin — the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
  /**
   * The repo has a `recipe.json`. False (never discovered) hides the affordance
   * entirely — an opener onto nothing is not a destination.
   */
  hasRecipe?: boolean;
  /** The main pane is showing the recipe — the button reads pressed. */
  recipeOpen?: boolean;
  onToggleRecipe?: () => void;
  /** The PR head ref scoping this view (EE PR view); undefined at repo level. */
  prRef?: string | null;
  /** The commit the corpus was read at (hosted) — the baseline-fallback label. */
  flowsCommit?: string | null;
}) {
  // The corpus counted once, by the same predicate that narrows the list — a
  // chip can never promise rows the list won't show. `all` is not a chip: an
  // empty selection IS every flow.
  const options = useMemo<FilterOption[]>(
    () => guardFlowFilterCounts(flows).filter((c) => c.key !== 'all').map(({ key, label, count }) => ({ key, label, count })),
    [flows],
  );

  // PR view whose corpus fell back to the baseline set (the gate ran the baseline
  // flows against the head without re-persisting them).
  const baselineFallback = !!prRef && !!flowsCommit && flowsCommit !== prRef;

  return (
    <EntityList<GuardFlowListItem>
      label="Test inventory"
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
        placeholder: 'Search tests…',
        ariaLabel: 'Search tests',
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
      noun={{ one: 'test', many: 'tests' }}
      rowClassName={(flow) => (dismissedFlowIds?.has(flow.flowId) ? 'opacity-60' : undefined)}
      renderRow={(flow) => <FlowRow flow={flow} dismissed={dismissedFlowIds?.has(flow.flowId) === true} />}
      noMatch="No tests match these filters."
      // The MAIN pane carries the single CTA empty state — the panel stays quiet so
      // two identical cards never sit side by side.
      emptyText="No tests yet."
      // The one thing here that is not a flow: the preparation every flow in the
      // list runs against. It lives with the list, not in the pane's header —
      // the pane belongs to whichever flow is open.
      {...(hasRecipe && onToggleRecipe
        ? {
            toolbar: (
              <HoverPopover portal width="wide" align="start" content={GUARD_RECIPE_HINT}>
                <button
                  type="button"
                  aria-pressed={recipeOpen}
                  onClick={onToggleRecipe}
                  className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors ${
                    recipeOpen
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  <Hammer className="h-3 w-3 shrink-0" />
                  Recipe
                </button>
              </HoverPopover>
            ),
          }
        : {})}
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
