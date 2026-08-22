// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/guard/GuardFlowsPanel.tsx; delete with the preview.
/**
 * THE guard inventory, the ONE list. A flow and the test that realizes it are one
 * entity, so there is one list of them and one detail behind it (no second Tests
 * tab quoting a different count for the same rows).
 *
 * ONE flat list, no grouping chrome, failing flows first (severity-led). Findings
 * are not a block of their own, a flow carrying them reads as Failed and opens
 * them in its detail.
 *
 * ONE ROW ANATOMY, shared with every other guard list: the TITLE, the GOAL, then a
 * chip line whose FIRST chip is the one status word (the five of coverage:
 * Failed / Blocked / Never run / Succeeded / Not testable, every row, whatever the
 * flow's shape). Everything after it is a MARKER, never a status: epic, manual,
 * ruled-out, not-in-specs, our-defect. What a blocked flow NEEDS, the generator's
 * reason for it, and the milestone / section counts are all detail copy, a row
 * never carries a sentence or a tally.
 *
 * NO SURFACE CHIPS ON A ROW. A chip per surface repeated the same word down the
 * whole list; which surfaces a test drives is a NARROWING question, and it is
 * answered by the driver filter over the list instead.
 *
 * A hand-written test belongs to no synthesized flow: it is a row here like any
 * other, wearing the `manual` marker. The list is total, everything guard runs is
 * in it.
 *
 * The list itself, search, the status and driver filter chips, the row
 * interaction, the scroll-to-selection, is the shared {@link EntityList}; this
 * file is the flow's ROW and the flow's narrowing rules. The preparation a test
 * runs against is NOT here: a recipe is per-surface, so it is read on the
 * Interfaces tab, beside the surface it prepares.
 *
 * A flow the user RULED OUT stays in the list, muted and marked: hiding it would
 * make the ruling unreachable (only the detail can undo it), and the corpus keeps
 * synthesizing the flow whether or not anyone tests it. The row is the state; the
 * detail is where it is undone.
 */

import { useMemo } from 'react';
import { Layers, PenLine } from 'lucide-react';
import type { GuardFlowListItem } from '@/preview/vendor/shared';
import { GUARD_COVERAGE_STATUS_PRECEDENCE, GUARD_DRIVERS, guardDriver } from '@/preview/vendor/shared';
import { CHIP_CLASS } from '@/preview/ui/bits';
import { EntityList, type FilterOption } from '@/preview/ui/entity-list';
import { HoverPopover } from '@/preview/ui/hover-popover';
import {
  GUARD_FLOW_STATUS_ORDER,
  guardFlowFilterCounts,
  guardFlowMatchesFilter,
  guardFlowPlainStatus,
  type GuardFlowFilter,
} from '@/preview/vendor/lib/guard-flow-status';
import { flowTabId } from '@/preview/vendor/hooks/useGuardFlowTabs';
import {
  GuardDismissedChip,
  GuardFlowStatusChip,
  GuardNotInSpecsChip,
  GuardToolDefectChip,
} from '@/preview/vendor/components/guard/GuardStatusBadge';

/**
 * The drivers ONE test exercises, the step kinds its scenario actually uses, off
 * the wire. A mixed test (a sandbox scenario with web steps in it) carries two,
 * and matches EITHER chip: there is no "mixed" chip, because "mixed" is not a
 * surface anyone tests on.
 */
function flowDrivers(flow: GuardFlowListItem): readonly string[] {
  return flow.drivers ?? [];
}

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
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-normal leading-snug text-foreground">{flow.title}</span>
        <GuardFlowStatusChip status={plain} />
      </span>
      <div className="flex w-full flex-wrap items-center gap-1">
        {/* Not a status: the marker for a flow the specs no longer derive, so a
            scan of the list spots it without reading the sentence. */}
        {flow.orphaned && <GuardNotInSpecsChip />}
        {/* Also not a status, the user's own ruling. Its undo lives in the detail. */}
        {dismissed && <GuardDismissedChip />}
        {/* Nor is this one: the last generate produced a finding that was OUR
            defect, so nothing was committed and nothing here is red. */}
        {flow.toolDefects > 0 && <GuardToolDefectChip />}
        {flow.epic && (
          <HoverPopover portal width="narrow" content="Epic flow, it chains other flows end to end.">
            <span className={`${CHIP_CLASS} gap-1`}>
              <Layers className="h-3 w-3" />
              epic
            </span>
          </HoverPopover>
        )}
        {flow.manual && (
          <HoverPopover portal width="narrow" content="Hand-written test, it belongs to no synthesized flow.">
            <span className={`${CHIP_CLASS} gap-1`}>
              <PenLine className="h-3 w-3" />
              manual
            </span>
          </HoverPopover>
        )}
        {/* The drivers this test's STEPS exercise, identity facts, so they wear
            the plain muted chip, never a verdict colour. A mixed test wears one
            chip per driver; the same derivation the panel's filter narrows on. */}
        {flowDrivers(flow).map((driver) => (
          <span
            key={driver}
            className={CHIP_CLASS}
          >
            {guardDriver(driver)?.label ?? driver}
          </span>
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
  drivers,
  onDrivers,
  onOpen,
  prRef,
  flowsCommit,
  dismissedFlowIds,
}: {
  flows: GuardFlowListItem[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** The flows the user ruled out (`scenarios/decisions.json`), the row marker. */
  dismissedFlowIds?: ReadonlySet<string>;
  /** The active filter, owned above so it survives a main-pane navigation. */
  filter: GuardFlowFilter;
  onFilter: (filter: GuardFlowFilter) => void;
  /**
   * The drivers the list is narrowed to (empty = every driver), owned above for
   * the same reason the status filter is. Multi-select: a mixed test is kept by
   * either of its drivers, so picking both is a union, never an intersection.
   */
  drivers: readonly string[];
  onDrivers: (next: string[]) => void;
  /** Single-click preview (transient tab), double-click pin, the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
  /** The PR head ref scoping this view (EE PR view); undefined at repo level. */
  prRef?: string | null;
  /** The commit the corpus was read at (hosted), the baseline-fallback label. */
  flowsCommit?: string | null;
}) {
  // The corpus counted once, by the same predicate that narrows the list, a
  // chip can never promise rows the list won't show. `all` is not a chip: an
  // empty selection IS every flow.
  const options = useMemo<FilterOption[]>(
    () => guardFlowFilterCounts(flows).filter((c) => c.key !== 'all').map(({ key, label, count }) => ({ key, label, count })),
    [flows],
  );

  // The same rule for the drivers: counted by the predicate that narrows, and
  // only for drivers this corpus HAS, a chip for a driver nothing runs on is
  // engine knowledge, not user information.
  const driverOptions = useMemo<FilterOption[]>(
    () =>
      GUARD_DRIVERS.map((d) => d.id as string)
        .map((driver) => ({
          key: driver,
          label: guardDriver(driver)?.label ?? driver,
          count: flows.filter((f) => flowDrivers(f).includes(driver)).length,
        }))
        .filter((o) => o.count > 0),
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
      filter={[
        {
          label: 'Status',
          ariaLabel: 'Filter by status',
          options,
          selected: filter === 'all' ? [] : [filter],
          onChange: (next) => onFilter((next[0] as GuardFlowFilter) ?? 'all'),
          match: (flow, key) => guardFlowMatchesFilter(flow, key as GuardFlowFilter),
        },
        {
          label: 'Drivers',
          ariaLabel: 'Filter by driver',
          options: driverOptions,
          selected: drivers,
          onChange: onDrivers,
          multi: true,
          match: (flow, key) => flowDrivers(flow).includes(key),
        },
      ]}
      noun={{ one: 'test', many: 'tests' }}
      rowClassName={(flow) => (dismissedFlowIds?.has(flow.flowId) ? 'opacity-60' : undefined)}
      renderRow={(flow) => <FlowRow flow={flow} dismissed={dismissedFlowIds?.has(flow.flowId) === true} />}
      noMatch="No tests match these filters."
      // The MAIN pane carries the single CTA empty state, the panel stays quiet so
      // two identical cards never sit side by side.
      emptyText="No tests yet."
      banner={
        baselineFallback ? (
          <div className="shrink-0 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            Showing the baseline flows, this PR didn&apos;t regenerate them.
          </div>
        ) : null
      }
    />
  );
}
