/**
 * The Flows tab's MAIN PANE — the shared GuardTabStrip (a permanent Overview chip
 * plus any opened flow, addressable as `?gflow=`) over the matching detail:
 *
 *   flow → the milestone graph and ONE row per surface (its test, or why there is
 *          none); a test row opens on the TESTS tab, which is where tests live
 *   none → the overview: the list's filter dashboard, the recipe card and the
 *          one last-generate line
 *
 * A test is never a tab here: it has exactly one home, and two homes for one thing
 * is how a reader loses track of which is authoritative.
 */

import { useMemo } from 'react';
import { FlaskConical, Loader2, Workflow } from 'lucide-react';
import type { GuardFlowsView, GuardGenerateReport } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import type { GuardFlowFilter } from '@/lib/guard-flow-status';
import type { GuardDecisionsState } from '@/hooks/useGuardDecisions';
import { useGuardFlowDetail } from '@/hooks/useGuardFlowDetail';
import { tabFlowId } from '@/hooks/useGuardFlowTabs';
import type { GuardTabsState } from '@/hooks/useGuardTabs';
import type { BlockedConflictRow } from './GuardBlockedPanel';
import { GuardFlowDetail } from './GuardFlowDetail';
import { GuardScenariosOverview } from './GuardScenariosOverview';
import { GuardTabStrip, type GuardTabStripItem } from './GuardTabStrip';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardFlowsPane({
  repoId,
  view,
  loading,
  error,
  report,
  tabs,
  filter,
  onFilter,
  reloadKey = 0,
  prRef,
  conflicts = null,
  decisions,
  onOpenConflict,
  onOpenSpec,
  onOpenTest,
  onOpenInterface,
  onOpenExternals,
}: {
  repoId: string;
  view: GuardFlowsView | null;
  loading: boolean;
  error: string | null;
  report: GuardGenerateReport | null;
  tabs: GuardTabsState;
  /** The list's filter — the overview's chips set it, the panel reads it. */
  filter: GuardFlowFilter;
  onFilter: (filter: GuardFlowFilter) => void;
  reloadKey?: number;
  prRef?: string;
  /**
   * The LIVE open conflicts, only meaningful when the report is `open-conflicts`.
   * `null` while the spec corpus is still loading (the blocked panel spins).
   */
  conflicts?: BlockedConflictRow[] | null;
  /**
   * The committable dismissals — the flow detail's "don't test this flow" ruling
   * and its undo. Omitted (guard reads off / an unresolved PR scope) hides the
   * ruling entirely: a decision the reader could not have seen never gets made.
   */
  decisions?: GuardDecisionsState;
  onOpenConflict?: (key: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
  /** Open a test on the Tests tab (`?gtest=`). */
  onOpenTest: (testId: string) => void;
  onOpenInterface: (interfaceId: string) => void;
  /**
   * Jump to the External APIs tab, on the named service's card — the needs-setup
   * CTA a flow's why-no-test row carries.
   */
  onOpenExternals?: (service?: string) => void;
}) {
  const { activeId, openTabs, open, close, selectOverview } = tabs;
  const flows = view?.flows ?? [];

  const activeFlowId = tabFlowId(activeId);
  const { detail, loading: detailLoading } = useGuardFlowDetail(repoId, activeFlowId, reloadKey, prRef);

  const flowTitles = useMemo(() => new Map(flows.map((f) => [f.flowId, f.title])), [flows]);

  const tabItems = useMemo<GuardTabStripItem[]>(
    () =>
      openTabs.map((t) => {
        const flowId = tabFlowId(t.id);
        const label = flowId ? flowTitles.get(flowId) ?? flowId : t.id;
        return { ...t, label, title: flowId ?? t.id, icon: Workflow };
      }),
    [openTabs, flowTitles],
  );

  const content = (() => {
    if (activeFlowId) {
      if (detail) {
        return (
          <GuardFlowDetail
            key={detail.flowId}
            detail={detail}
            {...(decisions ? { decisions } : {})}
            onOpenSpec={onOpenSpec}
            onOpenTest={onOpenTest}
            onOpenInterface={onOpenInterface}
            {...(onOpenExternals ? { onOpenExternals } : {})}
          />
        );
      }
      if (detailLoading) {
        return (
          <Centered>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </Centered>
        );
      }
      return (
        <EmptyState
          icon={FlaskConical}
          title="Flow not found"
          body="This flow is not in the current corpus — it may have been re-composed under a new id."
        />
      );
    }

    return (
      <GuardScenariosOverview
        recipe={view?.recipe ?? null}
        report={report}
        flows={flows}
        filter={filter}
        onFilter={onFilter}
        loading={loading}
        error={error}
        conflicts={conflicts}
        onOpenConflict={onOpenConflict}
      />
    );
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <GuardTabStrip
        tabs={tabItems}
        activeId={activeId}
        onSelect={(t) => open(t.id, t.pinned)}
        onSelectOverview={selectOverview}
        onClose={close}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}
