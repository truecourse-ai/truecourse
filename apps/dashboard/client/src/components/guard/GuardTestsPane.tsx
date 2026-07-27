/**
 * The Tests tab's MAIN PANE — the shared GuardTabStrip (a permanent Overview chip
 * plus any opened test, addressable as `?gtest=`) over {@link GuardTestDetail}.
 *
 * A test row names its flow, so the pane loads that flow's detail to get the rich
 * per-test facts the inventory read does not carry (the failure, the evidence
 * pointer, the journey path, and the milestone chain the detail's ruling resolves
 * its claim from). A `?gtest=` deep link therefore resolves the same way whether
 * the user arrived from a flow, from a run, or from a bookmark.
 */

import { useMemo } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import type { GuardJourneyRow } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import type { GuardDecisionsState } from '@/hooks/useGuardDecisions';
import { useGuardFlowDetail } from '@/hooks/useGuardFlowDetail';
import type { GuardTabsState } from '@/hooks/useGuardTabs';
import { guardTestLabel, type GuardTestRow } from '@/lib/guard-tests';
import { GuardTestDetail } from './GuardTestDetail';
import { GuardTabStrip, type GuardTabStripItem } from './GuardTabStrip';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

/** The overview: what the corpus holds, in one line of numbers. */
function TestsOverview({ tests }: { tests: GuardTestRow[] }) {
  const passing = tests.filter((t) => t.status.plain === 'passing').length;
  const failing = tests.filter((t) => t.status.plain === 'failing').length;
  const stats = [
    { label: 'tests', value: tests.length },
    { label: 'passing', value: passing },
    { label: 'failing', value: failing },
  ];
  return (
    <div role="region" aria-label="Tests overview" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Committed tests
        </div>
        <div className="flex flex-wrap gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1.5"
            >
              <span className="text-sm font-semibold text-foreground">{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Guard commits every test it writes, including the ones that fail the first time they run — a
          failing test means the doc and the code disagree, not that generation went wrong. Pick one to
          see what it checks, how it ran, and the exact steps.
        </p>
      </div>
    </div>
  );
}

export function GuardTestsPane({
  repoId,
  tests,
  loading,
  error,
  runId,
  journeys,
  flowGoals,
  decisions,
  tabs,
  reloadKey = 0,
  prRef,
  onOpenFlow,
  onOpenJourney,
  onOpenSpec,
}: {
  repoId: string;
  tests: GuardTestRow[];
  loading: boolean;
  error: string | null;
  /** The run the outcomes were joined from; null when never run. */
  runId: string | null;
  journeys: GuardJourneyRow[] | null;
  /** flowId → the flow's one-line goal, for the "what it checks" line. */
  flowGoals: ReadonlyMap<string, string>;
  /** The dismissals state behind the detail's "don't test this claim" ruling. */
  decisions?: GuardDecisionsState;
  tabs: GuardTabsState;
  reloadKey?: number;
  prRef?: string;
  onOpenFlow: (flowId: string) => void;
  onOpenJourney: (journeyId: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const { activeId, openTabs, open, close, selectOverview } = tabs;

  const byId = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const active = activeId ? byId.get(activeId) ?? null : null;

  // The rich per-test facts live on the flow join — load the active test's flow.
  const { detail, loading: detailLoading } = useGuardFlowDetail(
    repoId,
    active?.flowId ?? null,
    reloadKey,
    prRef,
  );
  const row = detail?.surfaces.find((s) => s.scenarioId === activeId) ?? null;

  const tabItems = useMemo<GuardTabStripItem[]>(
    () =>
      openTabs.map((t) => {
        const test = byId.get(t.id);
        return {
          ...t,
          label: test ? test.title : t.id,
          title: test ? `${guardTestLabel(test.surface)} — ${t.id}` : t.id,
          icon: FlaskConical,
        };
      }),
    [openTabs, byId],
  );

  const content = (() => {
    if (activeId && !active) {
      if (loading) {
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
          body="This test is not in the committed corpus — it may have been removed, or rewritten under a new id."
        />
      );
    }

    if (active) {
      return (
        <GuardTestDetail
          key={active.id}
          repoId={repoId}
          test={active}
          row={row}
          runId={runId}
          journeys={journeys}
          {...(flowGoals.get(active.flowId) ? { flowGoal: flowGoals.get(active.flowId) } : {})}
          milestones={detail?.milestones ?? []}
          {...(decisions ? { decisions } : {})}
          onOpenFlow={onOpenFlow}
          onOpenJourney={onOpenJourney}
          onOpenSpec={onOpenSpec}
        />
      );
    }

    if (loading && tests.length === 0) {
      return (
        <Centered>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Centered>
      );
    }
    if (error && tests.length === 0) {
      return (
        <Centered>
          <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
        </Centered>
      );
    }
    if (tests.length === 0) {
      return (
        <EmptyState
          icon={FlaskConical}
          title="No tests yet"
          body={
            <>
              Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to
              write tests for the flows your spec describes.
            </>
          }
        />
      );
    }
    return <TestsOverview tests={tests} />;
  })();

  // The detail's own spinner while the flow join is still in flight.
  const busy = active != null && row == null && detailLoading;

  return (
    // `min-w-0` all the way down: the detail's wide data blocks scroll themselves,
    // which only works if every box above them is allowed to shrink.
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <GuardTabStrip
        tabs={tabItems}
        activeId={activeId}
        onSelect={(t) => open(t.id, t.pinned)}
        onSelectOverview={selectOverview}
        onClose={close}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {busy && (
          <div className="pointer-events-none absolute right-3 top-3 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {content}
      </div>
    </div>
  );
}
