// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/guard/GuardFlowsPane.tsx; delete with the preview.
/**
 * THE guard MAIN PANE, the shared GuardTabStrip (any opened flow, addressable as
 * `?flow=`) over the merged flow detail: the flow's header and milestones, and
 * then the test that realizes it, whole ({@link GuardFlowDetail}).
 *
 * A test is not a destination of its own any more, and has no address of its own:
 * one flow, one test, one page, two homes for one thing is how a reader loses
 * track of which is authoritative.
 *
 * There is no Overview destination. The LIST beside this pane is the tab, it
 * carries the corpus, its counts and its narrowing, so with no flow open this
 * pane is at rest ("pick a flow"), not a second thing to read.
 *
 * It has no non-flow subject at all: the preparation a test runs against is
 * per-surface, and is read on the Interfaces tab beside the surface it prepares.
 */

import { useMemo } from 'react';
import { Loader2, FlaskConical } from 'lucide-react';
import type { GuardFlowsView, GuardInterfaceRow } from '@/preview/vendor/shared';
import { EmptyState } from '@/components/ui/empty-state';
import type { GuardDecisionsState } from '@/preview/vendor/hooks/useGuardDecisions';
import { useGuardFlowDetail } from '@/preview/vendor/hooks/useGuardFlowDetail';
import { tabFlowId } from '@/preview/vendor/hooks/useGuardFlowTabs';
import type { GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';
import type { GuardTestBinds } from '@/preview/vendor/lib/guard-tests';
import { GuardFlowDetail } from '@/preview/vendor/components/guard/GuardFlowDetail';
import { GuardTabStrip, type GuardTabStripItem } from '@/preview/vendor/components/guard/GuardTabStrip';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardFlowsPane({
  repoId,
  view,
  loading,
  error,
  tabs,
  interfaces = null,
  claimTitles,
  binds,
  reloadKey = 0,
  prRef,
  decisions,
  onOpenSpec,
  onOpenInterface,
  onOpenExternals,
}: {
  repoId: string;
  view: GuardFlowsView | null;
  loading: boolean;
  error: string | null;
  tabs: GuardTabsState;
  /** The mapped interface catalog, for the diagrams a test drives; null = unmapped. */
  interfaces?: GuardInterfaceRow[] | null;
  /** Claim id → its sentence, for a step group named by claim identity. */
  claimTitles?: Readonly<Record<string, string>>;
  /** scenarioId → the spec section it binds to (the inventory join). */
  binds?: ReadonlyMap<string, GuardTestBinds>;
  reloadKey?: number;
  prRef?: string;
  /**
   * The committable dismissals, the flow detail's "don't test this flow" ruling
   * and its undo, plus the read-only note on a claim already dismissed. Omitted
   * (guard reads off / an unresolved PR scope) hides both entirely: a decision the
   * reader could not have seen never gets made.
   */
  decisions?: GuardDecisionsState;
  onOpenSpec: (doc: string, section: string) => void;
  onOpenInterface: (interfaceId: string) => void;
  /**
   * Jump to the Dependencies tab, on the named service's card, the needs-setup
   * CTA a flow's why-no-test block carries.
   */
  onOpenExternals?: (service?: string) => void;
}) {
  const { activeId, openTabs, open, close } = tabs;
  const flows = view?.flows ?? [];

  const activeFlowId = tabFlowId(activeId);
  const { detail, loading: detailLoading } = useGuardFlowDetail(repoId, activeFlowId, reloadKey, prRef);

  const flowTitles = useMemo(() => new Map(flows.map((f) => [f.flowId, f.title])), [flows]);

  const tabItems = useMemo<GuardTabStripItem[]>(
    () =>
      openTabs.map((t) => {
        const flowId = tabFlowId(t.id);
        const label = flowId ? flowTitles.get(flowId) ?? flowId : t.id;
        return { ...t, label, title: flowId ?? t.id, icon: FlaskConical };
      }),
    [openTabs, flowTitles],
  );

  const content = (() => {
    if (activeFlowId) {
      if (detail) {
        return (
          <GuardFlowDetail
            key={detail.flowId}
            repoId={repoId}
            detail={detail}
            interfaces={interfaces}
            {...(claimTitles ? { claimTitles } : {})}
            {...(binds ? { binds } : {})}
            {...(decisions ? { decisions } : {})}
            {...(prRef ? { prRef } : {})}
            onOpenSpec={onOpenSpec}
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
          title="Test not found"
          body="Not in the current corpus, it may have been re-composed under a new id."
        />
      );
    }

    if (loading && flows.length === 0) {
      return (
        <Centered>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Centered>
      );
    }
    if (error && flows.length === 0) {
      return (
        <Centered>
          <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
        </Centered>
      );
    }
    if (flows.length === 0) {
      return (
        <EmptyState
          icon={FlaskConical}
          title="No tests yet"
          body={
            <>
              Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to
              synthesize flows and write their tests.
            </>
          }
        />
      );
    }
    return (
      <EmptyState icon={FlaskConical} title="Select a test" body="" />
    );
  })();

  return (
    // `min-w-0` all the way down: the detail's wide data blocks scroll themselves,
    // which only works if every box above them is allowed to shrink.
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* No Overview chip: with no flow open this pane IS its no-selection state. */}
      <GuardTabStrip tabs={tabItems} activeId={activeId} onSelect={(t) => open(t.id, t.pinned)} onClose={close} />
      <div className="relative min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}
