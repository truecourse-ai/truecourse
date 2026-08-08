/**
 * The Guard "Runs" sub-view — a run inspector, analyze-style: the selected run's
 * summary on the LEFT, its FULL results in the MIDDLE (severity-led non-pass
 * scenarios first, then a collapsible passed group), and — in the RIGHT pane — a
 * preview/pinned TAB STRIP over each opened scenario's run-scoped detail. Selecting
 * a row previews a tab (double-click pins), the same tab model the Scenarios tab
 * uses (`useGuardTabs`, here bound to `?gdrift`). With no tab open the right pane
 * is AT REST ("pick a result") — the run's envelope is the aside's job and its
 * outcomes are the middle column's groups, so there is no overview destination to
 * return to. The detail itself is the
 * merged flow detail's own scenario rendering, so no parallel test screen exists.
 * Switching the
 * selected run keeps the tabs but re-resolves each against the new run — a scenario
 * absent from it shows an honest "not in this run" state. Current state only (no
 * diff mode); no run at all points at `guard run`.
 */

import { useMemo } from 'react';
import { FlaskConical, GitMerge, Loader2, PlayCircle } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useGuardRuns } from '@/hooks/useGuardRuns';
import { useGuardView } from '@/hooks/useGuardView';
import { useGuardTabs } from '@/hooks/useGuardTabs';
import { orderGuardDrifts } from '@/lib/guard-drifts';
import { GuardRunSummary } from './GuardRunSummary';
import { GuardDriftList } from './GuardDriftList';
import { GuardDriftDetail } from './GuardDriftDetail';
import { GuardTabStrip } from './GuardTabStrip';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardDriftsView({
  repoId,
  enabled = true,
  reloadKey = 0,
  prRef,
  prNumber,
  blockedOnConflicts = false,
}: {
  repoId: string;
  enabled?: boolean;
  /** Bumped on a guard generate/run completion → refetch the run data. */
  reloadKey?: number;
  /** The PR head SHA when viewing a pull request (EE) — scopes the run to that
   *  commit and switches the empty state to the gate-status card. */
  prRef?: string;
  /** The PR number (EE) — scopes the run picker to the PR's own timeline
   *  (one run per pushed head); without it a PR view lists no history. */
  prNumber?: number;
  /**
   * The last guard generate ended `open-conflicts` — test generation is blocked,
   * so there can be no run. The no-run empty state says so and routes to the
   * Coverage tab (which owns the conflict list). Repo view only; the PR view's
   * gate-status cards take precedence.
   */
  blockedOnConflicts?: boolean;
}) {
  const { openSpecSection, openSpecCoverage, openGuardFlow } = useGuardView();
  const { latest, history, run, selectedRunId, selectRun, pending, loading, error } = useGuardRuns(
    repoId,
    enabled,
    reloadKey,
    prRef,
    prNumber,
  );
  const { activeId, openTabs, open, close } = useGuardTabs('gdrift', repoId);

  const drifts = useMemo(() => orderGuardDrifts(run?.scenarios), [run]);
  const passed = useMemo(() => (run?.scenarios ?? []).filter((s) => s.outcome === 'pass'), [run]);
  // The scenarios of the CURRENTLY selected run, indexed for tab re-resolution:
  // a tab kept across a run switch is looked up here against the new run.
  const byId = useMemo(() => new Map((run?.scenarios ?? []).map((s) => [s.id, s])), [run]);
  const activeScenario = activeId ? byId.get(activeId) ?? null : null;

  const tabItems = useMemo(
    () => openTabs.map((t) => ({ ...t, label: t.id, title: byId.get(t.id)?.title ?? t.id })),
    [openTabs, byId],
  );

  if (loading && !run) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }
  if (error && !run) {
    return (
      <Centered>
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
      </Centered>
    );
  }
  if (!latest || !run) {
    // PR view: the server never falls back to the baseline for a PR head, so an
    // absent run means the gate hasn't produced one at this commit. Show the gate's
    // status (queued/running) or an explicit "hasn't run yet" — never baseline data.
    if (prRef) {
      return pending ? (
        <EmptyState
          icon={Loader2}
          title={pending.status === 'running' ? 'Guard gate running' : 'Guard gate queued'}
          body={
            <>
              The guard gate is {pending.status} for this commit — its results will appear here once it
              finishes.
            </>
          }
        />
      ) : (
        <EmptyState
          icon={PlayCircle}
          title="Guard gate hasn't run at this commit yet"
          body="Its results appear here once the gate completes."
        />
      );
    }
    // Test generation is blocked on unresolved spec conflicts, so nothing exists
    // to run. Point at the Coverage tab to resolve them rather than at a run that
    // can't happen yet.
    if (blockedOnConflicts) {
      return (
        <EmptyState
          icon={GitMerge}
          title="Blocked by open spec conflicts"
          body={
            <button
              type="button"
              onClick={openSpecCoverage}
              className="text-primary underline hover:text-primary/80"
            >
              Resolve them on the Coverage tab
            </button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={PlayCircle}
        title="No guard run yet"
        body={
          <>
            Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard run</code> to run the
            committed tests.
          </>
        }
      />
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* LEFT — THE run: its envelope, its tallies, and the history that switches
          between runs. The right pane never repeats any of it. */}
      <aside className="w-72 shrink-0 overflow-hidden border-r border-border bg-card">
        <GuardRunSummary run={run} history={history} selectedRunId={selectedRunId} onSelectRun={selectRun} />
      </aside>

      {/* MIDDLE — full results: severity-led drifts, then the passed group */}
      <div className="w-[360px] shrink-0 overflow-hidden border-r border-border">
        <GuardDriftList
          key={run.run.runId}
          drifts={drifts}
          passed={passed}
          activeId={activeId}
          onPreview={(id) => open(id, false)}
          onPin={(id) => open(id, true)}
        />
      </div>

      {/* RIGHT — the tab strip over each opened result's run-scoped detail. No
          Overview chip: with nothing open this pane is at rest, because the run
          itself is already read in the aside beside it. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <GuardTabStrip
          tabs={tabItems}
          activeId={activeId}
          onSelect={(t) => open(t.id, t.pinned)}
          onClose={close}
        />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {activeScenario ? (
            // Keyed by run + scenario so the evidence/YAML open-state and fetched
            // content reset whenever the shown scenario OR selected run changes.
            <GuardDriftDetail
              key={`${run.run.runId}\0${activeScenario.id}`}
              repoId={repoId}
              scenario={activeScenario}
              runId={run.run.runId}
              runFlow={
                (run.runFlows ?? []).find((f) => f.flowId === activeScenario.flowId) ?? null
              }
              onOpenSpec={openSpecSection}
              onOpenFlow={openGuardFlow}
            />
          ) : activeId ? (
            // A tab kept across a run switch whose scenario the new run doesn't have.
            <EmptyState
              icon={FlaskConical}
              title="Not in this run"
              body={
                <>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{activeId}</code> was not part of the
                  selected run.
                </>
              }
            />
          ) : (
            <EmptyState icon={FlaskConical} title="Select a result" body="Select a result." />
          )}
        </div>
      </div>
    </div>
  );
}
